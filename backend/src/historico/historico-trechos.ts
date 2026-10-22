import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { bancoCompartilhado } from '../banco/banco.js';
import { config } from '../config.js';
import type { FonteHistorico, PercursoTipico } from '../linhas/trechos.js';
import { ehFeriado } from './feriados.js';
import { ArmazemTrechos, type RegistroTrecho } from './armazem-trechos.js';

export const ARMAZEM_TRECHOS = Symbol('ARMAZEM_TRECHOS');
/** Primeira janela mais larga: até isso (min) antes e depois do horário. */
const AMPLO_MIN = 120;
/** Medida mínima de um trecho numa janela para ela valer (a do trecho). */
const MINIMO_M = config.trechos.tamanhoM * config.trechos.coberturaMin;

export type ParametrosHistorico = typeof config.historico;

/** Histórico de um itinerário num tipo de dia, como veio do banco. */
interface Carga {
  estado: 'carregando' | 'pronto' | 'falhou';
  em: number;
  /** faixa → trecho → percurso acumulado. */
  faixas: Map<number, Map<number, PercursoTipico>>;
  /** O último `tipico` calculado (muda só com a faixa ou numa releitura). */
  calculado?: {
    faixa: number;
    faixas: Carga['faixas'];
    valor: Map<number, PercursoTipico>;
  };
  /** Resolve quando a leitura termina (com sucesso ou não). */
  pronta: Promise<void>;
}

export interface ResumoHistorico {
  /** Há banco configurado (`DATABASE_URL`). */
  ativo: boolean;
  /** Trechos medidos esperando a próxima gravação. */
  pendentes: number;
  ultimaGravacao: string | null;
  ultimaFalha: string | null;
  itinerariosCarregados: number;
}

/**
 * Memória de longo prazo da velocidade por trecho: quanto os ônibus levam em
 * cada trecho, por tipo de dia (útil, sábado, domingo) e faixa de 30 min.
 * Com ela, uma linha recém-aberta (ou o servidor recém-acordado) já começa
 * com o ritmo típico daquele horário em vez de 18 km/h.
 *
 * O que é medido fica em memória e vai para o banco em lote a cada 5 min;
 * o histórico de cada itinerário é lido uma vez e relido a cada 6 h. Sem
 * banco, ou com o banco fora do ar, tudo continua funcionando só com as
 * medidas ao vivo.
 */
@Injectable()
export class HistoricoTrechos implements FonteHistorico, OnApplicationShutdown {
  private readonly logger = new Logger(HistoricoTrechos.name);
  private readonly armazem: ArmazemTrechos | null;
  private readonly pendentes = new Map<string, RegistroTrecho>();
  private readonly cargas = new Map<string, Carga>();
  private ultimaGravacao: number | null = null;
  private ultimaFalha: number | null = null;
  private gravando = false;

  constructor(
    @Optional()
    @Inject(ARMAZEM_TRECHOS)
    armazem?: ArmazemTrechos | null,
    @Optional()
    @Inject('PARAMETROS_HISTORICO')
    private readonly p: ParametrosHistorico = config.historico,
  ) {
    this.armazem = armazem === undefined ? armazemPostgres(this.p) : armazem;
  }

  registrar(
    itinerario: string,
    assinatura: string,
    trecho: number,
    metros: number,
    segundos: number,
    t: number,
  ): void {
    if (!this.armazem) return;
    const { tipoDia, faixa } = horarioLocal(t, this.p);
    const chave = `${itinerario}|${tipoDia}|${faixa}|${trecho}`;
    const r = this.pendentes.get(chave);
    if (r && r.assinatura === assinatura) {
      r.metros += metros;
      r.segundos += segundos;
    } else {
      this.pendentes.set(chave, {
        itinerario,
        assinatura,
        tipoDia,
        faixa,
        trecho,
        metros,
        segundos,
      });
    }
  }

  /**
   * Percurso típico de cada trecho no horário de `agora`, do mesmo tipo de
   * dia: a faixa atual mais meio peso das vizinhas (suaviza e cobre faixas
   * com pouca medida). Trecho sem medida bastante nessa janela usa as faixas
   * até ±2 h e, sem elas, o dia todo (marcado `amplo`): o ritmo daquele
   * pedaço de rua noutro horário erra menos que a média da linha inteira.
   * Na 1ª chamada dispara a leitura do banco e devolve `undefined` até ela
   * chegar.
   */
  tipico(
    itinerario: string,
    assinatura: string,
    agora: number,
  ): Map<number, PercursoTipico> | undefined {
    if (!this.armazem) return undefined;
    const carga = this.cargaDe(itinerario, assinatura, agora);
    if (carga.faixas.size === 0) return undefined;
    const { faixa } = horarioLocal(agora, this.p);
    const c = carga.calculado;
    if (c && c.faixa === faixa && c.faixas === carga.faixas) return c.valor;

    const faixasNoDia = (24 * 60) / this.p.faixaMin;
    const somar = (pesos: [deslocamento: number, peso: number][]) => {
      const soma = new Map<number, PercursoTipico>();
      for (const [d, peso] of pesos) {
        const f = (((faixa + d) % faixasNoDia) + faixasNoDia) % faixasNoDia;
        for (const [k, v] of carga.faixas.get(f) ?? []) {
          const r = soma.get(k) ?? { metros: 0, segundos: 0 };
          r.metros += v.metros * peso;
          r.segundos += v.segundos * peso;
          soma.set(k, r);
        }
      }
      return soma;
    };
    const raio = Math.round(AMPLO_MIN / this.p.faixaMin);
    const janelas = [
      somar([
        [0, 1],
        [-1, 0.5],
        [1, 0.5],
      ]),
      somar(
        Array.from(
          { length: 2 * raio + 1 },
          (_, i) => [i - raio, 1] as [number, number],
        ),
      ),
      somar([...carga.faixas.keys()].map((f) => [f - faixa, 1])),
    ];
    // Trecho por trecho, a 1ª janela com medida bastante.
    const [proxima, ...largas] = janelas;
    const resultado = new Map(proxima);
    for (const janela of largas) {
      for (const [k, v] of janela) {
        const atual = resultado.get(k);
        if (atual && atual.metros >= MINIMO_M) continue;
        if (v.metros > (atual?.metros ?? 0))
          resultado.set(k, { ...v, amplo: true });
      }
    }
    carga.calculado = { faixa, faixas: carga.faixas, valor: resultado };
    return resultado;
  }

  /**
   * Garante que o histórico do itinerário está sendo lido e espera a leitura
   * terminar. Quem chama limita a espera (a leitura pode demorar).
   */
  async preparar(
    itinerario: string,
    assinatura: string,
    agora: number,
  ): Promise<void> {
    if (this.armazem) await this.cargaDe(itinerario, assinatura, agora).pronta;
  }

  /** Grava o que foi medido desde a última vez. Se falhar, tenta no próximo ciclo. */
  @Interval('gravar-historico', config.historico.gravarMs)
  async gravar(): Promise<void> {
    if (!this.armazem || this.gravando || this.pendentes.size === 0) return;
    this.gravando = true;
    const lote = [...this.pendentes.values()];
    this.pendentes.clear();
    try {
      await this.armazem.gravar(lote);
      this.ultimaGravacao = Date.now();
    } catch (e) {
      this.ultimaFalha = Date.now();
      this.logger.warn(`Falha ao gravar histórico: ${(e as Error).message}`);
      // Devolve o lote, sem deixar a memória crescer sem limite.
      for (const r of lote) {
        if (this.pendentes.size >= 50_000) break;
        const chave = `${r.itinerario}|${r.tipoDia}|${r.faixa}|${r.trecho}`;
        const atual = this.pendentes.get(chave);
        if (atual && atual.assinatura === r.assinatura) {
          atual.metros += r.metros;
          atual.segundos += r.segundos;
        } else if (!atual) {
          this.pendentes.set(chave, r);
        }
      }
    } finally {
      this.gravando = false;
    }
  }

  resumo(): ResumoHistorico {
    const iso = (t: number | null) => (t ? new Date(t).toISOString() : null);
    return {
      ativo: this.armazem !== null,
      pendentes: this.pendentes.size,
      ultimaGravacao: iso(this.ultimaGravacao),
      ultimaFalha: iso(this.ultimaFalha),
      itinerariosCarregados: [...this.cargas.values()].filter(
        (c) => c.estado === 'pronto',
      ).length,
    };
  }

  /** Ao desligar (deploy, servidor dormindo), não perde o que foi medido. */
  async onApplicationShutdown(): Promise<void> {
    await this.gravar();
  }

  /** Histórico do itinerário no tipo de dia de `agora`; (re)lê do banco se preciso. */
  private cargaDe(itinerario: string, assinatura: string, agora: number) {
    const { tipoDia } = horarioLocal(agora, this.p);
    const chave = `${itinerario}|${assinatura}|${tipoDia}`;
    const carga = this.cargas.get(chave);
    const vencida =
      !carga ||
      (carga.estado === 'pronto' && agora - carga.em > this.p.recarregarMs) ||
      (carga.estado === 'falhou' &&
        agora - carga.em > this.p.esperaAposFalhaMs);
    return vencida
      ? this.carregar(chave, itinerario, assinatura, tipoDia, carga)
      : carga;
  }

  private carregar(
    chave: string,
    itinerario: string,
    assinatura: string,
    tipoDia: number,
    anterior: Carga | undefined,
  ): Carga {
    // Enquanto recarrega, continua servindo o que já tinha.
    const carga: Carga = {
      estado: 'carregando',
      em: Date.now(),
      faixas: anterior?.faixas ?? new Map(),
      pronta: Promise.resolve(),
    };
    this.cargas.set(chave, carga);
    carga.pronta = this.armazem!.carregar(itinerario, assinatura, tipoDia).then(
      (linhas) => {
        const faixas = new Map<number, Map<number, PercursoTipico>>();
        for (const l of linhas) {
          let f = faixas.get(l.faixa);
          if (!f) faixas.set(l.faixa, (f = new Map()));
          f.set(l.trecho, { metros: l.metros, segundos: l.segundos });
        }
        carga.faixas = faixas;
        carga.estado = 'pronto';
        carga.em = Date.now();
      },
      (e: unknown) => {
        carga.estado = 'falhou';
        carga.em = Date.now();
        this.ultimaFalha = Date.now();
        this.logger.warn(
          `Falha ao ler histórico de ${itinerario}: ${(e as Error).message}`,
        );
      },
    );
    return carga;
  }
}

/** Tipo de dia (feriado conta como domingo) e faixa de horário, no horário de Natal. */
export function horarioLocal(
  t: number,
  p: Pick<ParametrosHistorico, 'fusoMin' | 'faixaMin'> = config.historico,
): { tipoDia: number; faixa: number } {
  const local = new Date(t + p.fusoMin * 60_000);
  const dia = local.getUTCDay();
  // Feriado tem trânsito e tabela de domingo.
  const domingo = dia === 0 || ehFeriado(local.toISOString().slice(0, 10));
  return {
    tipoDia: domingo ? 2 : dia === 6 ? 1 : 0,
    faixa: Math.floor(
      (local.getUTCHours() * 60 + local.getUTCMinutes()) / p.faixaMin,
    ),
  };
}

function armazemPostgres(p: ParametrosHistorico): ArmazemTrechos | null {
  const db = bancoCompartilhado();
  return db ? new ArmazemTrechos(db, p.meiaVidaMs) : null;
}
