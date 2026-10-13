import { Inject, Injectable, Optional } from '@nestjs/common';
import { config } from '../config.js';
import { type Celula, vizinhasDeRumo } from './celulas.js';

export type ParametrosTransito = typeof config.transito;

interface Acumulado {
  /** Σ peso · ln(razão): média geométrica, simétrica para lento e rápido. */
  soma: number;
  peso: number;
  em: number;
}

export interface ResumoTransito {
  /** Pedaços de rua com medida recente. */
  celulas: number;
  /** Linhas que contribuíram. */
  linhas: number;
}

/**
 * Trânsito da cidade medido pelos ônibus de todas as linhas acompanhadas.
 *
 * Linhas diferentes param em pontos diferentes, então a velocidade crua de
 * uma não serve para outra. O que se compartilha é a razão "velocidade
 * agora ÷ velocidade típica daquele trecho e horário" (do histórico): se
 * os ônibus da 85 estão 40% mais lentos que o normal na Salgado Filho, a
 * previsão da 33 ali também fica 40% mais lenta.
 *
 * Cada linha só usa o que as outras mediram: o que ela mesma mede já entra
 * direto na velocidade dos trechos dela.
 */
@Injectable()
export class TransitoCidade {
  private readonly celulas = new Map<Celula, Map<string, Acumulado>>();

  constructor(
    @Optional()
    @Inject('PARAMETROS_TRANSITO')
    private readonly p: ParametrosTransito = config.transito,
  ) {}

  /** A linha andou em `celulas` a `razao` × a velocidade típica, por `metros`. */
  registrar(
    celulas: Celula[],
    linha: string,
    razao: number,
    metros: number,
    t: number,
  ): void {
    if (!(razao > 0) || !(metros > 0) || celulas.length === 0) return;
    const log = Math.log(this.limitar(razao));
    const peso = metros / celulas.length;
    for (const c of celulas) {
      let porLinha = this.celulas.get(c);
      if (!porLinha) this.celulas.set(c, (porLinha = new Map()));
      const a = porLinha.get(linha);
      if (!a) {
        porLinha.set(linha, { soma: log * peso, peso, em: t });
        continue;
      }
      const decai = this.decaimento(Math.max(0, t - a.em));
      a.soma = a.soma * decai + log * peso;
      a.peso = a.peso * decai + peso;
      a.em = Math.max(a.em, t);
    }
  }

  /**
   * Quanto mais lento (< 1) ou rápido (> 1) que o normal as outras linhas
   * estão nesses pedaços de rua agora, ou `undefined` sem medida suficiente.
   */
  fator(
    celulas: Celula[],
    linhaExcluida: string,
    agora: number,
  ): number | undefined {
    let soma = 0;
    let peso = 0;
    const consultadas = new Set(celulas.flatMap(vizinhasDeRumo));
    for (const c of consultadas) {
      for (const [linha, a] of this.celulas.get(c) ?? []) {
        const idade = agora - a.em;
        if (linha === linhaExcluida || idade > this.p.janelaMs) continue;
        const decai = this.decaimento(Math.max(0, idade));
        soma += a.soma * decai;
        peso += a.peso * decai;
      }
    }
    if (peso < this.p.minimoM) return undefined;
    return this.limitar(Math.exp(soma / peso));
  }

  esquecerAntigos(agora: number): void {
    for (const [c, porLinha] of this.celulas) {
      for (const [linha, a] of porLinha) {
        if (agora - a.em > this.p.janelaMs) porLinha.delete(linha);
      }
      if (porLinha.size === 0) this.celulas.delete(c);
    }
  }

  resumo(): ResumoTransito {
    const linhas = new Set<string>();
    for (const porLinha of this.celulas.values()) {
      for (const l of porLinha.keys()) linhas.add(l);
    }
    return { celulas: this.celulas.size, linhas: linhas.size };
  }

  private decaimento(idadeMs: number): number {
    return Math.pow(0.5, idadeMs / this.p.meiaVidaMs);
  }

  private limitar(v: number): number {
    return Math.max(this.p.fatorMin, Math.min(this.p.fatorMax, v));
  }
}
