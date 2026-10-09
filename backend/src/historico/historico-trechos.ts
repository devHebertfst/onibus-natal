import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import pg from 'pg';
import { config } from '../config.js';
import type { FonteHistorico, PercursoTipico } from '../linhas/trechos.js';
import { ArmazemTrechos, type RegistroTrecho } from './armazem-trechos.js';

export const ARMAZEM_TRECHOS = Symbol('ARMAZEM_TRECHOS');

export type ParametrosHistorico = typeof config.historico;

/** Histórico de um itinerário num tipo de dia, como veio do banco. */
interface Carga {
  estado: 'carregando' | 'pronto' | 'falhou';
  em: number;
  /** faixa → trecho → percurso acumulado. */
  faixas: Map<number, Map<number, PercursoTipico>>;
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
   * Percurso típico de cada trecho no horário de `agora`: a faixa atual mais
   * meio peso das vizinhas (suaviza e cobre faixas com pouca medida). Na 1ª
   * chamada dispara a leitura do banco e devolve `undefined` até ela chegar.
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

    const faixasNoDia = (24 * 60) / this.p.faixaMin;
    const resultado = new Map<number, PercursoTipico>();
    for (const [f, peso] of [
      [faixa, 1],
      [(faixa + faixasNoDia - 1) % faixasNoDia, 0.5],
      [(faixa + 1) % faixasNoDia, 0.5],
    ]) {
      for (const [k, v] of carga.faixas.get(f) ?? []) {
        const r = resultado.get(k) ?? { metros: 0, segundos: 0 };
        r.metros += v.metros * peso;
        r.segundos += v.segundos * peso;
        resultado.set(k, r);
      }
    }
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
    await this.armazem?.encerrar();
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

/** Tipo de dia e faixa de horário de um instante, no horário de Natal. */
export function horarioLocal(
  t: number,
  p: Pick<ParametrosHistorico, 'fusoMin' | 'faixaMin'> = config.historico,
): { tipoDia: number; faixa: number } {
  const local = new Date(t + p.fusoMin * 60_000);
  const dia = local.getUTCDay();
  return {
    tipoDia: dia === 0 ? 2 : dia === 6 ? 1 : 0,
    faixa: Math.floor(
      (local.getUTCHours() * 60 + local.getUTCMinutes()) / p.faixaMin,
    ),
  };
}

function armazemPostgres(p: ParametrosHistorico): ArmazemTrechos | null {
  if (!p.databaseUrl) return null;
  const pool = new pg.Pool({
    connectionString: p.databaseUrl,
    max: 2,
    // O Neon derruba conexões ociosas: melhor fechar antes.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // Sem isso, uma conexão ociosa derrubada pelo servidor derruba o processo.
  pool.on('error', (e) =>
    new Logger(HistoricoTrechos.name).warn(
      `Conexão com o banco caiu: ${e.message}`,
    ),
  );
  return new ArmazemTrechos(pool, p.meiaVidaMs, () => pool.end());
}
