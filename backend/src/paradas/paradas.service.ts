import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { config } from '../config.js';
import { haversine } from '../linhas/geo.js';
import { emParalelo, numeroDaLinha } from '../linhas/linhas.service.js';
import { NubusClient } from '../nubus/nubus.client.js';
import {
  type ParadaCidade,
  parseParadas,
  parseParadasCidade,
} from '../nubus/nubus.parse.js';
import type { NubusItinerario } from '../nubus/nubus.types.js';
import type { LinhaNaParadaDto, ParadaProximaDto } from './paradas.dto.js';

/** Raio máximo da busca (m): mais longe que isso não é "perto de mim". */
const RAIO_MAXIMO_M = 1_500;
const RAIO_PADRAO_M = 600;
const QUANTAS = 8;
/** Quantos itinerários consultar em paralelo ao montar o índice. */
const CONCORRENCIA = 4;

interface Rede {
  paradas: ParadaCidade[];
  /** Código da parada → linhas que passam nela. */
  linhas: Map<string, LinhaNaParadaDto[]>;
  montadaEm: number;
}

/**
 * Paradas da cidade e quais linhas passam em cada uma. A API não tem esse
 * índice nem uma lista de linhas: a busca de rotas é por trecho, então
 * buscar "0" a "9" traz todas as que têm número (~120 itinerários), e as
 * paradas de cada itinerário dizem por onde ele passa. Montado uma vez por dia.
 */
@Injectable()
export class ParadasService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ParadasService.name);
  private rede?: Rede;
  private emAndamento?: Promise<Rede>;

  constructor(private readonly nubus: NubusClient) {}

  onApplicationBootstrap(): void {
    if (!config.aquecerParadas) return;
    this.obterRede().catch((e: unknown) =>
      this.logger.warn(
        `Índice de paradas não montado: ${(e as Error).message}`,
      ),
    );
  }

  /** Paradas com ônibus perto de uma posição, da mais perto à mais longe. */
  async proximas(
    lat: number,
    lng: number,
    raio = RAIO_PADRAO_M,
  ): Promise<ParadaProximaDto[]> {
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      throw new BadRequestException('Posição inválida');
    }
    const limite = Math.min(
      Number.isFinite(raio) && raio > 0 ? raio : RAIO_PADRAO_M,
      RAIO_MAXIMO_M,
    );

    const rede = await this.obterRede();
    const aqui = { lat, lng };
    const resultado: ParadaProximaDto[] = [];
    for (const p of rede.paradas) {
      const linhas = rede.linhas.get(p.codigo);
      if (!linhas) continue; // parada sem nenhuma linha passando
      const metros = haversine(aqui, p);
      if (metros <= limite)
        resultado.push({ ...p, metros: Math.round(metros), linhas });
    }
    return resultado.sort((a, b) => a.metros - b.metros).slice(0, QUANTAS);
  }

  private obterRede(): Promise<Rede> {
    const rede = this.rede;
    if (rede && Date.now() - rede.montadaEm < config.paradasTtlMs)
      return Promise.resolve(rede);
    this.emAndamento ??= this.montar()
      .then((nova) => (this.rede = nova))
      .catch((e: unknown) => {
        // Índice vencido é melhor que nenhum.
        if (rede) return rede;
        throw new BadGatewayException(
          `API de transporte indisponível: ${(e as Error).message}`,
        );
      })
      .finally(() => (this.emAndamento = undefined));
    return this.emAndamento;
  }

  private async montar(): Promise<Rede> {
    const inicio = Date.now();
    const paradas = parseParadasCidade(await this.nubus.listarParadas());

    const itinerarios = new Map<string, NubusItinerario>();
    for (const digito of '0123456789') {
      for (const it of await this.nubus.pesquisarRotas(digito)) {
        if (it.codigoItinerario == null || it.codigoItinerario === '') continue;
        if (!it.descricaolinha) continue;
        itinerarios.set(String(it.codigoItinerario), it);
      }
    }

    const linhas = new Map<string, LinhaNaParadaDto[]>();
    let falhas = 0;
    await emParalelo([...itinerarios.values()], CONCORRENCIA, async (it) => {
      let resposta;
      try {
        resposta = await this.nubus.paradasEspecifica(
          String(it.codigoItinerario),
          false,
        );
      } catch {
        falhas++;
        return;
      }
      const numero = numeroDaLinha(it.descricaolinha ?? '');
      const nome = (it.descricaoItinerario ?? '').trim();
      for (const parada of parseParadas(resposta.paradas)) {
        let lista = linhas.get(parada.codigo);
        if (!lista) linhas.set(parada.codigo, (lista = []));
        let linha = lista.find((l) => l.numero === numero);
        if (!linha) lista.push((linha = { numero, itinerarios: [] }));
        if (nome && !linha.itinerarios.includes(nome))
          linha.itinerarios.push(nome);
      }
    });
    if (itinerarios.size === 0 || falhas === itinerarios.size) {
      throw new Error('nenhum itinerário respondeu');
    }
    for (const lista of linhas.values())
      lista.sort((a, b) =>
        a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }),
      );

    this.logger.log(
      `Índice de paradas: ${paradas.length} paradas, ${itinerarios.size} itinerários` +
        `${falhas ? ` (${falhas} falharam)` : ''}, ${Date.now() - inicio} ms`,
    );
    return { paradas, linhas, montadaEm: Date.now() };
  }
}
