import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { config } from '../config.js';
import { NubusClient } from '../nubus/nubus.client.js';
import {
  parseCarros,
  parseParadas,
  parsePontos,
} from '../nubus/nubus.parse.js';
import type { ItinerarioDto, LinhaDto, OnibusDto } from './linha.dto.js';
import { RastreadorVelocidade } from './velocidade.js';

interface ItinerarioRef {
  codigo: string;
  descricao: string;
}

interface LinhaAcompanhada {
  numero: string;
  /** Último GET de algum cliente; linhas sem acesso deixam de ser consultadas. */
  ultimoAcesso: number;
  itinerarios?: { lista: ItinerarioRef[]; buscadoEm: number };
  snapshot?: LinhaDto;
  snapshotEm?: number;
  /** Atualização em andamento, compartilhada por quem pedir ao mesmo tempo. */
  emAndamento?: Promise<LinhaDto>;
}

const NUMERO_VALIDO = /^[A-Za-z0-9-]{1,10}$/;
/** Quantas linhas o loop atualiza em paralelo (gentileza com a API de origem). */
const CONCORRENCIA = 4;

/**
 * Mantém em memória os dados das linhas que estão sendo acompanhadas. A API
 * de transporte é consultada pelo loop (uma vez por linha a cada 15s), nunca
 * por requisição de cliente: mil usuários olhando a linha 33 geram a mesma
 * carga que um.
 */
@Injectable()
export class LinhasService {
  private readonly logger = new Logger(LinhasService.name);
  private readonly linhas = new Map<string, LinhaAcompanhada>();
  /** Global (e não por linha) porque o mesmo veículo pode trocar de linha. */
  private readonly velocidade = new RastreadorVelocidade();
  private loopRodando = false;

  constructor(private readonly nubus: NubusClient) {}

  /** Dados consolidados da linha. Na 1ª vez, consulta a API e passa a acompanhá-la. */
  async obter(numeroBruto: string): Promise<LinhaDto> {
    const numero = numeroBruto.trim().toUpperCase();
    if (!NUMERO_VALIDO.test(numero)) {
      throw new BadRequestException('Número de linha inválido');
    }

    let linha = this.linhas.get(numero);
    if (!linha) {
      if (this.linhas.size >= config.maxLinhasAcompanhadas) {
        throw new ServiceUnavailableException(
          'Muitas linhas acompanhadas no momento, tente novamente em instantes',
        );
      }
      linha = { numero, ultimoAcesso: Date.now() };
      this.linhas.set(numero, linha);
    }
    linha.ultimoAcesso = Date.now();

    if (linha.snapshot) return linha.snapshot;

    try {
      return await this.atualizar(linha);
    } catch (e) {
      // Não deixa linha inexistente (ou que falhou de primeira) presa no loop.
      if (!linha.snapshot) this.linhas.delete(numero);
      throw e;
    }
  }

  /** Números das linhas acompanhadas no momento (útil para debug/monitoramento). */
  acompanhadas(): string[] {
    return [...this.linhas.keys()];
  }

  /** Loop de atualização. Se um ciclo ainda estiver rodando, o próximo é pulado. */
  @Interval('atualizar-linhas', config.pollIntervalMs)
  async atualizarTodas(): Promise<void> {
    if (this.loopRodando) return;
    this.loopRodando = true;
    try {
      const agora = Date.now();
      const pendentes: LinhaAcompanhada[] = [];
      for (const linha of this.linhas.values()) {
        if (agora - linha.ultimoAcesso > config.linhaInativaMs) {
          this.linhas.delete(linha.numero);
          this.logger.log(
            `Linha ${linha.numero} sem acessos: parando de acompanhar`,
          );
        } else if (
          !linha.snapshotEm ||
          agora - linha.snapshotEm >= config.pollIntervalMs / 2
        ) {
          // (pula linhas que acabaram de ser buscadas por um GET)
          pendentes.push(linha);
        }
      }

      await emParalelo(pendentes, CONCORRENCIA, async (linha) => {
        try {
          await this.atualizar(linha);
        } catch (e) {
          this.logger.warn(
            `Falha ao atualizar linha ${linha.numero}: ${(e as Error).message}`,
          );
          if (linha.snapshot)
            linha.snapshot = { ...linha.snapshot, desatualizado: true };
        }
      });
      this.velocidade.esquecerAntigos(Date.now());
    } finally {
      this.loopRodando = false;
    }
  }

  private atualizar(linha: LinhaAcompanhada): Promise<LinhaDto> {
    linha.emAndamento ??= this.consolidar(linha).finally(() => {
      linha.emAndamento = undefined;
    });
    return linha.emAndamento;
  }

  /** Consulta os dois endpoints e monta a visão consolidada da linha. */
  private async consolidar(linha: LinhaAcompanhada): Promise<LinhaDto> {
    const itinerarios = await this.itinerariosDa(linha);

    const respostas = await Promise.allSettled(
      itinerarios.map((it) => this.nubus.paradasEspecifica(it.codigo)),
    );
    if (respostas.every((r) => r.status === 'rejected')) {
      throw new BadGatewayException(
        `API de transporte indisponível: ${(respostas[0] as PromiseRejectedResult).reason}`,
      );
    }

    const agora = Date.now();
    const itinerariosDto: ItinerarioDto[] = [];
    // Dedup: o mesmo veículo pode aparecer em mais de um itinerário da linha.
    const veiculos = new Map<
      string,
      { lat: number; lng: number; itinerarios: string[] }
    >();
    let falhou = false;

    respostas.forEach((r, i) => {
      const ref = itinerarios[i];
      if (r.status === 'rejected') {
        falhou = true;
        // Mantém o traçado anterior desse itinerário para o mapa não "piscar".
        const anterior = linha.snapshot?.itinerarios.find(
          (x) => x.codigo === ref.codigo,
        );
        if (anterior) itinerariosDto.push(anterior);
        return;
      }

      itinerariosDto.push({
        codigo: ref.codigo,
        descricao: ref.descricao,
        tracado: parsePontos(r.value.pontos).map((p) => [p.lat, p.lng]),
        paradas: parseParadas(r.value.paradas),
      });

      for (const carro of parseCarros(r.value.carros)) {
        const existente = veiculos.get(carro.id);
        if (existente) {
          if (!existente.itinerarios.includes(ref.codigo))
            existente.itinerarios.push(ref.codigo);
        } else {
          veiculos.set(carro.id, {
            lat: carro.lat,
            lng: carro.lng,
            itinerarios: [ref.codigo],
          });
        }
      }
    });

    const onibus: OnibusDto[] = [];
    for (const [id, v] of veiculos) {
      this.velocidade.registrar(id, v, agora);
      onibus.push({
        id,
        lat: v.lat,
        lng: v.lng,
        velocidadeKmh: Math.round(this.velocidade.velocidadeKmh(id, agora)),
        itinerarios: v.itinerarios,
        posicaoDesde: new Date(
          this.velocidade.posicaoDesde(id) ?? agora,
        ).toISOString(),
      });
    }
    onibus.sort((a, b) => a.id.localeCompare(b.id, 'pt-BR', { numeric: true }));

    const snapshot: LinhaDto = {
      numero: linha.numero,
      atualizadoEm: new Date(agora).toISOString(),
      desatualizado: falhou,
      itinerarios: itinerariosDto,
      onibus,
    };
    linha.snapshot = snapshot;
    linha.snapshotEm = agora;
    return snapshot;
  }

  /** Lista de itinerários da linha, com cache longo (quase nunca muda). */
  private async itinerariosDa(
    linha: LinhaAcompanhada,
  ): Promise<ItinerarioRef[]> {
    const cache = linha.itinerarios;
    if (cache && Date.now() - cache.buscadoEm < config.itinerariosTtlMs)
      return cache.lista;

    let brutos;
    try {
      brutos = await this.nubus.pesquisarRotas(linha.numero);
    } catch (e) {
      if (cache) return cache.lista; // cache vencido é melhor que nada
      throw new BadGatewayException(
        `API de transporte indisponível: ${(e as Error).message}`,
      );
    }

    // TODO: confirmar se a pesquisa é por prefixo (ex.: "33" trazendo "330").
    // Se for, filtrar aqui pelo número da linha presente na descrição.
    const lista = brutos
      .filter((b) => b.codigoItinerario != null && b.codigoItinerario !== '')
      .map((b) => ({
        codigo: String(b.codigoItinerario),
        descricao: (b.descricaoItinerario ?? '').trim(),
      }));
    if (lista.length === 0) {
      throw new NotFoundException(`Linha ${linha.numero} não encontrada`);
    }

    linha.itinerarios = { lista, buscadoEm: Date.now() };
    return lista;
  }
}

/** Executa `fn` sobre os itens com no máximo `limite` chamadas simultâneas. */
async function emParalelo<T>(
  itens: T[],
  limite: number,
  fn: (item: T) => Promise<void>,
) {
  let proximo = 0;
  const trabalhadores = Array.from(
    { length: Math.min(limite, itens.length) },
    async () => {
      while (proximo < itens.length) await fn(itens[proximo++]);
    },
  );
  await Promise.all(trabalhadores);
}
