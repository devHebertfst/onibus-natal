import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { CachePersistente } from '../banco/cache-persistente.js';
import type { LatLng } from './geo.js';
import type { ItinerarioDto } from './linha.dto.js';
import { segundosEntre } from './perfil.js';
import { RotaMetros } from './rota.js';

/** Antecedências medidas: a previsão feita X minutos antes da chegada. */
export const HORIZONTES_MIN = [2, 5, 10, 15] as const;
/** Uma previsão conta para o horizonte X se faltava X ± 1 min. */
const TOLERANCIA_HORIZONTE_MS = 60_000;
/** Distância máxima ao traçado para o ônibus contar como nele. */
const DISTANCIA_MAX_ROTA_M = 60;
/** Antes disso da parada ainda não é previsão (o ônibus está quase nela). */
const MARGEM_PARADA_M = 30;
/** Entre duas posições mais distantes que isso não dá para cravar a passagem. */
const SALTO_MAX_M = 3_000;
const INTERVALO_MAX_MS = 5 * 60_000;
/** Previsão que não se resolveu nesse tempo (o ônibus saiu da rota) é esquecida. */
const ESQUECER_PENDENTE_MS = 40 * 60_000;
/** A cada meia-vida, o placar antigo pesa metade: mostra o desempenho atual. */
const MEIA_VIDA_MS = 7 * 24 * 60 * 60_000;
/** Histograma do erro com sinal: caixas de 30 s, de −20 a +20 min. */
const CAIXA_MS = 30_000;
const CAIXAS = 81;
const CHAVE = 'placar-previsao:v1';

export type Fonte = 'nossa' | 'nubus';
const FONTES: Fonte[] = ['nossa', 'nubus'];

interface Estatistica {
  n: number;
  somaAbs: number;
  soma: number;
  hist: number[];
}

interface Placar {
  desde: number;
  em: number;
  fontes: Record<Fonte, Record<string, Estatistica>>;
  /** Mesma parada, mesmo ônibus, mesma antecedência: quem errou menos. */
  pares: Record<string, { n: number; nossaMelhor: number }>;
}

interface Pendente {
  criadaEm: number;
  previstas: Partial<Record<Fonte, Map<number, number>>>;
}

interface OnibusNaRota {
  s: number;
  t: number;
  /** Na última posição nova, andou para a frente neste itinerário. */
  avancando: boolean;
}

interface Itinerario {
  assinatura: string;
  rota: RotaMetros;
  /** Paradas pela posição no traçado, em ordem. */
  paradas: { codigo: string; s: number }[];
  trechos?: ItinerarioDto['trechos'];
  onibus: Map<string, OnibusNaRota>;
  /** "ônibus|parada" → previsões esperando a chegada. */
  pendentes: Map<string, Pendente>;
}

export interface OnibusObservado extends LatLng {
  id: string;
  itinerarios: string[];
  /** Quando o GPS mediu a posição. */
  t: number;
}

export interface ResumoHorizonte {
  n: number;
  /** Erro médio em minutos, para mais ou para menos. */
  erroMedioMin: number;
  /** Metade das previsões erra menos que isso (min). */
  medianaMin: number;
  /** 90% das previsões erram menos que isso (min). */
  p90Min: number;
  /** > 0: previu mais tarde do que o ônibus chegou (chegou antes). */
  viesMin: number;
}

export interface ResumoPlacar {
  desde: string;
  /** Por antecedência ("2", "5", "10", "15" min). */
  nossa: Record<string, ResumoHorizonte>;
  nubus: Record<string, ResumoHorizonte>;
  /** Quando as duas previram a mesma chegada: % em que a nossa errou menos. */
  comparacao: Record<string, { n: number; nossaMelhorPct: number }>;
}

/**
 * Placar da previsão de chegada: compara o que foi previsto com a chegada
 * real, para a nossa estimativa e para a da Nubus.
 *
 * - A cada atualização das linhas acompanhadas, calcula a nossa previsão
 *   (a mesma conta do app) para as paradas à frente de cada ônibus e guarda
 *   a feita a 2, 5, 10 e 15 min da chegada.
 * - A previsão da Nubus entra quando alguém (ou a amostragem de GPS) a
 *   consulta.
 * - Quando o ônibus passa pela parada, a hora da passagem sai da
 *   interpolação entre as duas posições ao redor dela, e o erro de cada
 *   previsão guardada vai para o placar.
 *
 * O placar perde metade do peso a cada 7 dias e fica guardado no banco.
 */
@Injectable()
export class PlacarPrevisao implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PlacarPrevisao.name);
  private readonly itinerarios = new Map<string, Itinerario>();
  private readonly cache: CachePersistente | null;
  private placar: Placar = vazio(Date.now());
  private sujo = false;

  constructor(
    @Optional() @Inject(CachePersistente) cache?: CachePersistente | null,
  ) {
    this.cache = cache ?? null;
  }

  async onModuleInit(): Promise<void> {
    const salvo = await this.cache?.ler<Placar>(CHAVE);
    if (salvo?.fontes && salvo.pares) this.placar = salvo;
  }

  /** Uma atualização da linha: posições novas e as velocidades por trecho. */
  observarLinha(
    itinerarios: ItinerarioDto[],
    onibus: OnibusObservado[],
    agora: number,
  ): void {
    for (const it of itinerarios) this.definir(it);
    for (const o of onibus) {
      for (const codigo of o.itinerarios) {
        const it = this.itinerarios.get(codigo);
        if (it) this.observarOnibus(it, o, agora);
      }
    }
    this.esquecerAntigos(agora);
  }

  /** A previsão da Nubus numa parada (o que a API devolveu agora). */
  registrarNubus(
    itinerario: string,
    parada: string,
    chegadas: { onibus: string | null; aoVivo: boolean; chegaEm: number }[],
    agora: number,
  ): void {
    const it = this.itinerarios.get(itinerario);
    if (!it || !it.paradas.some((p) => p.codigo === parada)) return;
    for (const c of chegadas) {
      if (!c.aoVivo || !c.onibus) continue;
      this.guardar(it, c.onibus, parada, 'nubus', c.chegaEm, agora);
    }
  }

  resumo(): ResumoPlacar {
    const p = this.placar;
    const porFonte = (f: Fonte) =>
      Object.fromEntries(
        Object.entries(p.fontes[f])
          .filter(([, e]) => e.n >= 0.5)
          .map(([h, e]) => [h, resumir(e)]),
      );
    return {
      desde: new Date(p.desde).toISOString(),
      nossa: porFonte('nossa'),
      nubus: porFonte('nubus'),
      comparacao: Object.fromEntries(
        Object.entries(p.pares)
          .filter(([, x]) => x.n >= 0.5)
          .map(([h, x]) => [
            h,
            {
              n: Math.round(x.n),
              nossaMelhorPct: Math.round((100 * x.nossaMelhor) / x.n),
            },
          ]),
      ),
    };
  }

  @Interval('gravar-placar', 5 * 60_000)
  async gravar(): Promise<void> {
    if (!this.sujo || !this.cache) return;
    this.sujo = false;
    await this.cache.gravar(CHAVE, this.placar);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.gravar();
  }

  private definir(dto: ItinerarioDto): void {
    if (dto.tracado.length < 2) return;
    const assinatura = `${dto.tracado.length}:${dto.tracado[0]}:${dto.tracado.at(-1)}`;
    let it = this.itinerarios.get(dto.codigo);
    if (!it || it.assinatura !== assinatura) {
      const rota = new RotaMetros(dto.tracado);
      // Em ordem, com a anterior como dica: o traçado pode repetir ruas.
      const paradas: Itinerario['paradas'] = [];
      let dica: number | undefined;
      for (const p of [...dto.paradas].sort((a, b) => a.ordem - b.ordem)) {
        dica = rota.projetar(p, dica).s;
        if (!paradas.some((x) => x.codigo === p.codigo))
          paradas.push({ codigo: p.codigo, s: dica });
      }
      paradas.sort((a, b) => a.s - b.s);
      it = {
        assinatura,
        rota,
        paradas,
        onibus: new Map(),
        pendentes: new Map(),
      };
      this.itinerarios.set(dto.codigo, it);
    }
    it.trechos = dto.trechos;
  }

  private observarOnibus(
    it: Itinerario,
    o: OnibusObservado,
    agora: number,
  ): void {
    const antes = it.onibus.get(o.id);
    const proj = it.rota.projetar(o, antes?.s);
    if (proj.distancia > DISTANCIA_MAX_ROTA_M) {
      it.onibus.delete(o.id);
      return;
    }

    let atual = antes;
    if (!antes || o.t > antes.t) {
      const avancando = !!antes && proj.s > antes.s + 10;
      if (
        antes &&
        avancando &&
        proj.s - antes.s <= SALTO_MAX_M &&
        o.t - antes.t <= INTERVALO_MAX_MS
      ) {
        // Paradas por onde passou entre as duas posições: hora da passagem.
        for (const p of it.paradas) {
          if (p.s <= antes.s || p.s > proj.s) continue;
          const real =
            antes.t + ((p.s - antes.s) / (proj.s - antes.s)) * (o.t - antes.t);
          this.resolver(it, o.id, p.codigo, real, agora);
        }
      }
      atual = { s: proj.s, t: o.t, avancando };
      it.onibus.set(o.id, atual);
    }
    if (!atual?.avancando) return; // sentido ainda não confirmado

    // A nossa previsão para as paradas à frente, como o app calcula.
    const maisLonge = (HORIZONTES_MIN.at(-1)! + 1) * 60_000;
    for (const p of it.paradas) {
      if (p.s < atual.s + MARGEM_PARADA_M) continue;
      const previsto = atual.t + segundosEntre(it.trechos, atual.s, p.s) * 1000;
      if (previsto - agora > maisLonge) break;
      this.guardar(it, o.id, p.codigo, 'nossa', previsto, agora);
    }
  }

  /** Guarda a previsão se ela cai num dos horizontes ainda sem registro. */
  private guardar(
    it: Itinerario,
    onibus: string,
    parada: string,
    fonte: Fonte,
    previsto: number,
    agora: number,
  ): void {
    const restante = previsto - agora;
    const h = HORIZONTES_MIN.find(
      (x) => Math.abs(restante - x * 60_000) <= TOLERANCIA_HORIZONTE_MS,
    );
    if (h === undefined) return;
    const chave = `${onibus}|${parada}`;
    let pendente = it.pendentes.get(chave);
    if (!pendente) {
      pendente = { criadaEm: agora, previstas: {} };
      it.pendentes.set(chave, pendente);
    }
    const porH = (pendente.previstas[fonte] ??= new Map());
    if (!porH.has(h)) porH.set(h, previsto);
  }

  private resolver(
    it: Itinerario,
    onibus: string,
    parada: string,
    real: number,
    agora: number,
  ): void {
    const chave = `${onibus}|${parada}`;
    const pendente = it.pendentes.get(chave);
    if (!pendente) return;
    it.pendentes.delete(chave);

    this.decair(agora);
    for (const h of HORIZONTES_MIN) {
      const erros: Partial<Record<Fonte, number>> = {};
      for (const f of FONTES) {
        const previsto = pendente.previstas[f]?.get(h);
        if (previsto === undefined) continue;
        const erro = previsto - real;
        erros[f] = erro;
        const e = (this.placar.fontes[f][h] ??= estatisticaVazia());
        e.n += 1;
        e.somaAbs += Math.abs(erro);
        e.soma += erro;
        const caixa = Math.round(erro / CAIXA_MS) + (CAIXAS - 1) / 2;
        e.hist[Math.max(0, Math.min(CAIXAS - 1, caixa))] += 1;
      }
      if (erros.nossa !== undefined && erros.nubus !== undefined) {
        const par = (this.placar.pares[h] ??= { n: 0, nossaMelhor: 0 });
        par.n += 1;
        const dif = Math.abs(erros.nubus) - Math.abs(erros.nossa);
        par.nossaMelhor += dif > 0 ? 1 : dif === 0 ? 0.5 : 0;
      }
    }
    this.sujo = true;
  }

  /** Pesos antigos caem pela metade a cada 7 dias. */
  private decair(agora: number): void {
    const p = this.placar;
    const k = Math.pow(0.5, Math.max(0, agora - p.em) / MEIA_VIDA_MS);
    p.em = agora;
    if (k === 1) return;
    for (const f of FONTES) {
      for (const e of Object.values(p.fontes[f])) {
        e.n *= k;
        e.somaAbs *= k;
        e.soma *= k;
        for (let i = 0; i < e.hist.length; i++) e.hist[i] *= k;
      }
    }
    for (const par of Object.values(p.pares)) {
      par.n *= k;
      par.nossaMelhor *= k;
    }
  }

  private esquecerAntigos(agora: number): void {
    for (const it of this.itinerarios.values()) {
      for (const [chave, p] of it.pendentes) {
        if (agora - p.criadaEm > ESQUECER_PENDENTE_MS)
          it.pendentes.delete(chave);
      }
      for (const [id, o] of it.onibus) {
        if (agora - o.t > ESQUECER_PENDENTE_MS) it.onibus.delete(id);
      }
    }
  }
}

function vazio(agora: number): Placar {
  return {
    desde: agora,
    em: agora,
    fontes: { nossa: {}, nubus: {} },
    pares: {},
  };
}

function estatisticaVazia(): Estatistica {
  return {
    n: 0,
    somaAbs: 0,
    soma: 0,
    hist: Array.from({ length: CAIXAS }, () => 0),
  };
}

const minutos = (ms: number) => Math.round(ms / 6_000) / 10;

function resumir(e: Estatistica): ResumoHorizonte {
  // Histograma do erro absoluto a partir do com sinal.
  const meio = (CAIXAS - 1) / 2;
  const abs = Array.from({ length: meio + 1 }, () => 0);
  e.hist.forEach((v, i) => (abs[Math.abs(i - meio)] += v));
  const total = abs.reduce((a, b) => a + b, 0);
  const quantil = (q: number) => {
    let acc = 0;
    for (let i = 0; i < abs.length; i++) {
      acc += abs[i];
      if (acc >= q * total) return i * CAIXA_MS;
    }
    return meio * CAIXA_MS;
  };
  return {
    n: Math.round(e.n),
    erroMedioMin: minutos(e.somaAbs / e.n),
    medianaMin: minutos(quantil(0.5)),
    p90Min: minutos(quantil(0.9)),
    viesMin: minutos(e.soma / e.n),
  };
}
