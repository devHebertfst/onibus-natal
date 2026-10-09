import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  Observable,
  Subject,
  defer,
  distinctUntilChanged,
  filter,
  from,
  merge,
} from 'rxjs';
import { config } from '../config.js';
import { NubusClient } from '../nubus/nubus.client.js';
import type { NubusItinerario } from '../nubus/nubus.types.js';
import {
  parseCarros,
  parseParadas,
  parsePontos,
} from '../nubus/nubus.parse.js';
import type { ItinerarioDto, LinhaDto, OnibusDto } from './linha.dto.js';
import { RastreadorVelocidade } from './velocidade.js';
import { VelocidadeTrechos } from './trechos.js';
import { RelogioGps } from '../nubus/relogio-gps.js';

export interface ResumoTrechos {
  linha: string;
  itinerario: string;
  /** % dos trechos do traçado com velocidade medida. */
  cobertura: number;
  mediaKmh: number | null;
}

export interface ItinerarioRef {
  codigo: string;
  descricao: string;
  /** Código da linha na operadora ("CDNO-33"), pedido pela previsão de chegada. */
  codigolinha: string;
}

interface LinhaAcompanhada {
  numero: string;
  /** Último GET de algum cliente; linhas sem acesso deixam de ser consultadas. */
  ultimoAcesso: number;
  /** Conexões de streaming abertas; enquanto houver, a linha segue acompanhada. */
  assinantes: number;
  itinerarios?: { lista: ItinerarioRef[]; buscadoEm: number };
  snapshot?: LinhaDto;
  snapshotEm?: number;
  /** Atualização em andamento, compartilhada por quem pedir ao mesmo tempo. */
  emAndamento?: Promise<LinhaDto>;
  /** Velocidade por trecho, aprendida com os ônibus desta linha. */
  trechos: VelocidadeTrechos;
}

// Com ponto por causa de linhas como a "745.1".
const NUMERO_VALIDO = /^[A-Za-z0-9.-]{1,10}$/;
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
  /** Cada snapshot novo (ou marcado como desatualizado) de qualquer linha. */
  private readonly atualizacoes = new Subject<LinhaDto>();

  constructor(
    private readonly nubus: NubusClient,
    private readonly relogio: RelogioGps = new RelogioGps(),
  ) {}

  /** Dados consolidados da linha. Na 1ª vez, consulta a API e passa a acompanhá-la. */
  async obter(numeroBruto: string): Promise<LinhaDto> {
    return this.snapshotDe(this.registrar(numeroBruto));
  }

  /**
   * Snapshot atual da linha e, depois, cada atualização do loop, empurrada
   * assim que sai (sem o cliente precisar perguntar). Enquanto houver alguém
   * inscrito, a linha não é descartada por inatividade.
   */
  observar(numeroBruto: string): Observable<LinhaDto> {
    return defer(() => {
      const linha = this.registrar(numeroBruto);
      linha.assinantes++;
      const fluxo = merge(
        from(this.snapshotDe(linha)),
        this.atualizacoes.pipe(filter((s) => s.numero === linha.numero)),
      ).pipe(distinctUntilChanged()); // 1ª busca chega pelos dois caminhos
      return new Observable<LinhaDto>((assinante) => {
        const sub = fluxo.subscribe(assinante);
        return () => {
          sub.unsubscribe();
          linha.assinantes--;
          linha.ultimoAcesso = Date.now();
        };
      });
    });
  }

  /** Valida o número e passa a acompanhar a linha (se ainda não estiver). */
  private registrar(numeroBruto: string): LinhaAcompanhada {
    // "098" e "98" são a mesma linha: uma só entrada no cache.
    const numero = numeroBruto
      .trim()
      .toUpperCase()
      .replace(/^0+(?=\d)/, '');
    if (!NUMERO_VALIDO.test(numero)) {
      throw new BadRequestException('Número de linha inválido');
    }

    let linha = this.linhas.get(numero);
    if (!linha) {
      if (
        this.linhas.size >= config.maxLinhasAcompanhadas &&
        !this.liberarVaga()
      ) {
        throw new ServiceUnavailableException(
          'Muitas linhas acompanhadas no momento, tente novamente em instantes',
        );
      }
      linha = {
        numero,
        ultimoAcesso: Date.now(),
        assinantes: 0,
        trechos: new VelocidadeTrechos(),
      };
      this.linhas.set(numero, linha);
    }
    linha.ultimoAcesso = Date.now();
    return linha;
  }

  private async snapshotDe(linha: LinhaAcompanhada): Promise<LinhaDto> {
    if (linha.snapshot) return linha.snapshot;

    try {
      return await this.atualizar(linha);
    } catch (e) {
      // Não deixa linha inexistente (ou que falhou de primeira) presa no loop.
      if (!linha.snapshot) this.linhas.delete(linha.numero);
      throw e;
    }
  }

  /**
   * Itinerário da linha pelo código, para a previsão de chegada. Usa a lista
   * em cache (a mesma do loop) e passa a acompanhar a linha, se preciso.
   */
  async itinerario(
    numeroBruto: string,
    codigo: string,
  ): Promise<ItinerarioRef> {
    const ref = (await this.itinerariosDa(this.registrar(numeroBruto))).find(
      (i) => i.codigo === codigo,
    );
    if (!ref) throw new NotFoundException('Itinerário não é desta linha');
    return ref;
  }

  /**
   * Linhas já acompanhadas, com snapshot e itinerários prontos, sem contar
   * como acesso: quem só observa (a amostragem de GPS) não pode manter uma
   * linha viva sozinho.
   */
  prontas(): { snapshot: LinhaDto; itinerarios: ItinerarioRef[] }[] {
    return [...this.linhas.values()].flatMap((l) =>
      l.snapshot && l.itinerarios
        ? [{ snapshot: l.snapshot, itinerarios: l.itinerarios.lista }]
        : [],
    );
  }

  /** Quanto de cada itinerário já tem velocidade medida (para o diagnóstico). */
  resumoTrechos(): ResumoTrechos[] {
    return [...this.linhas.values()].flatMap((l) =>
      (l.snapshot?.itinerarios ?? []).flatMap((it) => {
        if (!it.trechos) return [];
        const medidos = it.trechos.kmh.filter((v) => v !== null).length;
        return [
          {
            linha: l.numero,
            itinerario: it.codigo,
            cobertura: Math.round((100 * medidos) / it.trechos.kmh.length),
            mediaKmh: it.trechos.mediaKmh,
          },
        ];
      }),
    );
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
        if (linha.assinantes > 0) linha.ultimoAcesso = agora;
        if (agora - linha.ultimoAcesso > config.linhaInativaMs) {
          this.linhas.delete(linha.numero);
          this.logger.log(
            `Linha ${linha.numero} sem acessos: parando de acompanhar`,
          );
        } else if (
          !linha.snapshotEm ||
          agora - linha.snapshotEm >= this.intervaloDe(linha, agora)
        ) {
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
          if (linha.snapshot && !linha.snapshot.desatualizado) {
            linha.snapshot = { ...linha.snapshot, desatualizado: true };
            this.atualizacoes.next(linha.snapshot);
          }
        }
      });
      this.velocidade.esquecerAntigos(Date.now());
    } finally {
      this.loopRodando = false;
    }
  }

  /**
   * Quanto esperar desde o último snapshot para atualizar de novo. Linha sendo
   * vista: todo ciclo (a metade do intervalo pula só as que acabaram de ser
   * buscadas por um GET). Linha só "aquecida", sem ninguém olhando: a cada 2
   * ciclos (~30s, o ritmo do GPS), o bastante para manter velocidade e
   * sentido prontos sem dobrar a carga na API de origem.
   */
  private intervaloDe(linha: LinhaAcompanhada, agora: number): number {
    const emUso =
      linha.assinantes > 0 ||
      agora - linha.ultimoAcesso < 2 * config.pollIntervalMs;
    return emUso ? config.pollIntervalMs / 2 : 1.5 * config.pollIntervalMs;
  }

  /** Com o limite atingido, descarta a linha sem conexões há mais tempo sem acesso. */
  private liberarVaga(): boolean {
    let candidata: LinhaAcompanhada | undefined;
    for (const l of this.linhas.values()) {
      if (l.assinantes > 0 || l.emAndamento) continue;
      if (!candidata || l.ultimoAcesso < candidata.ultimoAcesso) candidata = l;
    }
    if (!candidata) return false;
    this.linhas.delete(candidata.numero);
    this.logger.log(
      `Limite de linhas atingido: deixando de acompanhar a ${candidata.numero}`,
    );
    return true;
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

    linha.trechos.definirTracados(itinerariosDto);
    const onibus: OnibusDto[] = [];
    // A posição foi medida antes de o backend vê-la: desconta o atraso típico
    // e, quando a previsão de chegada contou a hora real do GPS, usa ela.
    const atraso = this.relogio.atrasoEstimadoMs();
    for (const [id, v] of veiculos) {
      this.velocidade.registrar(id, v, agora, agora - atraso);
      const gps = this.relogio.ultimoDe(id);
      if (gps) {
        const medido = this.velocidade.corrigir(id, gps, gps.gpsEm);
        if (medido !== undefined) this.relogio.registrarAtraso(medido);
      }
      // Os trechos andam uma posição atrás, com a hora já corrigida pelo GPS.
      const anterior = this.velocidade.posicaoAnterior(id);
      if (anterior) {
        for (const codigo of v.itinerarios) {
          linha.trechos.observar(codigo, id, anterior, anterior.t);
        }
      }
      onibus.push({
        id,
        lat: v.lat,
        lng: v.lng,
        velocidadeKmh: arredondar(this.velocidade.velocidadeKmh(id, agora)),
        itinerarios: v.itinerarios,
        posicaoDesde: new Date(
          this.velocidade.posicaoDesde(id) ?? agora,
        ).toISOString(),
      });
    }
    onibus.sort((a, b) => a.id.localeCompare(b.id, 'pt-BR', { numeric: true }));
    linha.trechos.esquecerAntigos(agora);

    const snapshot: LinhaDto = {
      numero: linha.numero,
      atualizadoEm: new Date(agora).toISOString(),
      desatualizado: falhou,
      itinerarios: itinerariosDto.map((it) => ({
        ...it,
        trechos: linha.trechos.velocidades(it.codigo, agora),
      })),
      onibus,
    };
    linha.snapshot = snapshot;
    linha.snapshotEm = agora;
    this.atualizacoes.next(snapshot);
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

    // A pesquisa é por trecho: "33" traz também 33A, 33B e 133.
    const lista: ItinerarioRef[] = [];
    for (const b of filtrarPorLinha(brutos, linha.numero)) {
      if (b.codigoItinerario == null || b.codigoItinerario === '') continue;
      const codigo = String(b.codigoItinerario);
      if (lista.some((x) => x.codigo === codigo)) continue; // a API repete itens
      lista.push({
        codigo,
        descricao: (b.descricaoItinerario ?? '').trim(),
        codigolinha: (b.codigolinha ?? '').trim(),
      });
    }
    if (lista.length === 0) {
      throw new NotFoundException(`Linha ${linha.numero} não encontrada`);
    }

    linha.itinerarios = { lista, buscadoEm: Date.now() };
    return lista;
  }
}

/**
 * Mantém só os itinerários da linha pedida: "O-33" e "O-33 Extra" são da 33;
 * "O-33A" e "133" não. Zeros à esquerda não contam: "98" acha "098" e vice-
 * versa. Se a API não informar `descricaolinha`, não filtra.
 */
export function filtrarPorLinha(
  brutos: NubusItinerario[],
  numero: string,
): NubusItinerario[] {
  if (brutos.some((b) => !b.descricaolinha)) return brutos;
  const alvo = numeroDaLinha(numero);
  return brutos.filter((b) => numeroDaLinha(b.descricaolinha ?? '') === alvo);
}

/**
 * Número da linha como o passageiro digita: "O-33 Extra" → "33",
 * "N-073" → "73", "SE17" → "SE17".
 */
export function numeroDaLinha(descricaolinha: string): string {
  return descricaolinha
    .trim()
    .replace(/^[A-Za-z]+-/, '')
    .split(/\s+/)[0]
    .toUpperCase()
    .replace(/^0+(?=\d)/, '');
}

function arredondar(v: number | null): number | null {
  return v === null ? null : Math.round(v);
}

/** Executa `fn` sobre os itens com no máximo `limite` chamadas simultâneas. */
export async function emParalelo<T>(
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
