import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { haversine, type LatLng } from '../linhas/geo.js';
import { montarChegadas } from '../linhas/previsao.service.js';
import { NubusClient } from '../nubus/nubus.client.js';
import { coordenadaValida } from '../nubus/nubus.parse.js';
import { ParadasService } from '../paradas/paradas.service.js';
import {
  ESPERA_ESTIMADA_S,
  VELOCIDADE_ONIBUS,
  distanciasAcumuladas,
  metrosPe,
  planejarRotas,
  segundosPe,
  tracadoEntre,
  type Rota,
} from './roteador.js';
import { parseTrajetos } from './trajeto.parse.js';
import type {
  LocalTrajetoDto,
  TrajetoDto,
  TrechoDto,
  ViagemDto,
} from './trajeto.dto.js';

/** Data/hora de Natal para o endpoint, independente do fuso do servidor. */
export function dataNatal(ms: number): string {
  return new Date(ms - 3 * 60 * 60_000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

/** Ir a pé só aparece como alternativa até esta distância (m), se houver ônibus. */
const CAMINHADA_ALTERNATIVA_M = 2_000;
/** Menos que isso não vale um trecho de caminhada (m). */
const CAMINHADA_MINIMA_M = 30;
/** A previsão da Nubus só ajuda para saídas de agora até daqui a esse tempo. */
const PREVISAO_ATE_MS = 90 * 60_000;
const MAX_VIAGENS = 5;

/** Um ônibus passando no ponto: ao vivo (GPS) ou pela tabela. */
interface Passagem {
  em: number;
  aoVivo: boolean;
}

@Injectable()
export class TrajetosService {
  private readonly logger = new Logger(TrajetosService.name);

  constructor(
    private readonly nubus: NubusClient,
    private readonly paradas: ParadasService,
  ) {}

  async planejar(
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number,
    datetime?: string,
  ): Promise<TrajetoDto> {
    if (!coordenadaValida(fromLat, fromLng) || !coordenadaValida(toLat, toLng))
      throw new BadRequestException('Informe origem e destino válidos');
    const data =
      datetime === undefined
        ? dataNatal(Date.now())
        : datetime.replace('T', ' ');
    const completa = data.length === 16 ? `${data}:00` : data;
    const ms = Date.parse(completa.replace(' ', 'T') + '-03:00');
    if (
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(completa) ||
      !Number.isFinite(ms) ||
      dataNatal(ms) !== completa
    )
      throw new BadRequestException('Informe uma data e hora válidas de Natal');

    const origem: LocalTrajetoDto = {
      nome: 'Ponto de partida',
      lat: fromLat,
      lng: fromLng,
    };
    const destino: LocalTrajetoDto = {
      nome: 'Destino',
      lat: toLat,
      lng: toLng,
    };
    // O planejador da Nubus devolve só caminhadas; o nosso usa as paradas de
    // cada linha. A resposta dela ainda serve para o trajeto a pé (pelas ruas).
    const [nossas, daNubus] = await Promise.allSettled([
      this.planejarComOnibus(origem, destino, ms),
      this.nubus
        .planejarTrajeto(fromLat, fromLng, toLat, toLng, completa)
        .then(parseTrajetos),
    ]);
    if (nossas.status === 'rejected')
      this.logger.warn(
        `Planejador próprio indisponível: ${(nossas.reason as Error).message}`,
      );
    if (nossas.status === 'rejected' && daNubus.status === 'rejected')
      throw new BadGatewayException(
        `Planejador indisponível: ${(daNubus.reason as Error).message}`,
      );

    const comOnibus = nossas.status === 'fulfilled' ? nossas.value : [];
    const externas = daNubus.status === 'fulfilled' ? daNubus.value : [];
    const viagens = [
      ...comOnibus,
      // Se um dia a Nubus voltar a sugerir ônibus, essas entram também.
      ...externas.filter((v) => v.trechos.some((t) => t.modo === 'BUS')),
    ];
    const aPe =
      externas.find((v) => v.trechos.every((t) => t.modo === 'WALK')) ??
      this.soCaminhada(origem, destino, ms);
    if (!viagens.length || aPe.caminhadaMetros <= CAMINHADA_ALTERNATIVA_M)
      viagens.push(aPe);

    return {
      consultadoEm: new Date().toISOString(),
      viagens: viagens
        .sort((a, b) => Date.parse(a.fim) - Date.parse(b.fim))
        .slice(0, MAX_VIAGENS),
    };
  }

  private async planejarComOnibus(
    origem: LocalTrajetoDto,
    destino: LocalTrajetoDto,
    partida: number,
  ): Promise<ViagemDto[]> {
    const rotas = planejarRotas(await this.paradas.malha(), origem, destino);
    const comPrevisao =
      partida > Date.now() - 5 * 60_000 &&
      partida < Date.now() + PREVISAO_ATE_MS;
    const previsoes = new Map<string, Promise<Passagem[] | null>>();
    return Promise.all(
      rotas.map((r) =>
        this.montarViagem(r, origem, destino, partida, comPrevisao, previsoes),
      ),
    );
  }

  /** Horários de cada trecho: a pé, espera pelo ônibus (pela previsão, se houver) e viagem. */
  private async montarViagem(
    rota: Rota,
    origem: LocalTrajetoDto,
    destino: LocalTrajetoDto,
    partida: number,
    comPrevisao: boolean,
    previsoes: Map<string, Promise<Passagem[] | null>>,
  ): Promise<ViagemDto> {
    const trechos: TrechoDto[] = [];
    let agora = partida;
    let onde: LocalTrajetoDto = origem;

    for (const perna of rota.pernas) {
      const it = perna.itinerario;
      const embarque = it.paradas[perna.embarque];
      const desembarque = it.paradas[perna.desembarque];
      const ponto = local(embarque);
      agora = this.andar(trechos, onde, ponto, agora);

      let passa = agora + ESPERA_ESTIMADA_S * 1000;
      let fonteHorario: TrechoDto['fonteHorario'] = 'estimada';
      if (comPrevisao && it.codigolinha) {
        const chave = `${it.codigo}|${embarque.codigo}`;
        let previsao = previsoes.get(chave);
        if (!previsao) {
          previsao = this.horariosNoPonto(
            it.codigolinha,
            it.descricao,
            embarque.codigo,
          );
          previsoes.set(chave, previsao);
        }
        const chegadas = await previsao;
        // O primeiro que passa depois que o passageiro chega ao ponto.
        const proximo = chegadas?.find((c) => c.em >= agora - 30_000);
        if (proximo) {
          passa = proximo.em;
          fonteHorario = proximo.aoVivo ? 'ao-vivo' : 'tabela';
        }
      }

      const cum = distanciasAcumuladas(it);
      const metros = cum[perna.desembarque] - cum[perna.embarque];
      const fim = passa + (metros / VELOCIDADE_ONIBUS) * 1000;
      trechos.push({
        modo: 'BUS',
        inicio: new Date(passa).toISOString(),
        fim: new Date(fim).toISOString(),
        duracaoSegundos: Math.round((fim - passa) / 1000),
        metros: Math.round(metros),
        linha: it.numero,
        letreiro: it.descricao || null,
        partida: ponto,
        chegada: local(desembarque),
        tracado: tracadoEntre(perna),
        fonteHorario,
      });
      agora = fim;
      onde = local(desembarque);
    }
    agora = this.andar(trechos, onde, destino, agora);

    return {
      inicio: new Date(partida).toISOString(),
      fim: new Date(agora).toISOString(),
      duracaoSegundos: Math.round((agora - partida) / 1000),
      caminhadaMetros: trechos
        .filter((t) => t.modo === 'WALK')
        .reduce((s, t) => s + t.metros, 0),
      trechos,
    };
  }

  /** Acrescenta a caminhada de `de` até `para` (se for longe o bastante) e devolve a hora de chegada. */
  private andar(
    trechos: TrechoDto[],
    de: LocalTrajetoDto,
    para: LocalTrajetoDto,
    inicio: number,
  ): number {
    if (haversine(de, para) < CAMINHADA_MINIMA_M) return inicio;
    const fim = inicio + segundosPe(de, para) * 1000;
    trechos.push({
      modo: 'WALK',
      inicio: new Date(inicio).toISOString(),
      fim: new Date(fim).toISOString(),
      duracaoSegundos: Math.round((fim - inicio) / 1000),
      metros: Math.round(metrosPe(de, para)),
      linha: null,
      letreiro: null,
      partida: de,
      chegada: para,
      tracado: [
        [de.lat, de.lng],
        [para.lat, para.lng],
      ],
    });
    return fim;
  }

  private soCaminhada(
    origem: LocalTrajetoDto,
    destino: LocalTrajetoDto,
    partida: number,
  ): ViagemDto {
    const trechos: TrechoDto[] = [];
    const fim = this.andar(trechos, origem, destino, partida);
    return {
      inicio: new Date(partida).toISOString(),
      fim: new Date(fim).toISOString(),
      duracaoSegundos: Math.round((fim - partida) / 1000),
      caminhadaMetros: trechos[0]?.metros ?? 0,
      trechos,
    };
  }

  /** Quando o itinerário passa no ponto, do mais cedo ao mais tarde; null se falhar. */
  private async horariosNoPonto(
    codigolinha: string,
    descricao: string,
    parada: string,
  ): Promise<Passagem[] | null> {
    try {
      const brutas = await this.nubus.previsaoParada(
        codigolinha,
        descricao,
        parada,
      );
      return montarChegadas(brutas, Date.now()).map((c) => ({
        em: Date.parse(c.chegaEm),
        aoVivo: c.aoVivo,
      }));
    } catch {
      return null;
    }
  }
}

function local(p: LatLng & { descricao: string }): LocalTrajetoDto {
  return { nome: p.descricao || 'Parada', lat: p.lat, lng: p.lng };
}
