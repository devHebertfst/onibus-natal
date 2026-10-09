/** Amostras guardadas (as mais recentes) para cada medida. */
const MAX_AMOSTRAS = 500;
/** O mesmo ônibus só entra de novo na comparação depois disso. */
const INTERVALO_COMPARACAO_MS = 30_000;

export interface ResumoDiagnostico {
  /** Ônibus desenhado × posição real, medido a cada posição nova do GPS. */
  desenho: {
    amostras: number;
    /** Mediana (m): negativo = desenhado atrás do real; positivo = à frente. */
    medianaM: number | null;
    /** A mesma diferença em segundos de viagem. */
    medianaS: number | null;
    /** Parcela das amostras com o desenho atrás do real (%). */
    atrasPct: number | null;
  };
  /** Nossa estimativa de chegada × a da Nubus, para o mesmo ônibus. */
  comparacao: {
    amostras: number;
    /** Mediana de (nossa − Nubus), em minutos: positivo = a nossa diz mais tarde. */
    medianaMin: number | null;
    /** Diferença média absoluta (min). */
    mediaAbsMin: number | null;
  };
}

/**
 * Mede a precisão do app enquanto ele roda, para decidir ajustes com números
 * em vez de palpite. Barato: só guarda números; o painel `?debug=1` mostra.
 */
export class Diagnostico {
  private readonly desenhoM: number[] = [];
  private readonly desenhoS: number[] = [];
  private readonly comparacoes: number[] = [];
  private readonly ultimaComparacao = new Map<string, number>();

  /**
   * Chegou uma posição nova: quanto o desenho estava longe dela.
   * @param erroM desenhado − real ao longo do traçado (m).
   * @param velocidadeMs velocidade usada na extrapolação, para converter em segundos.
   */
  registrarDesenho(erroM: number, velocidadeMs: number): void {
    if (!Number.isFinite(erroM)) return;
    guardar(this.desenhoM, erroM);
    if (velocidadeMs > 0.5) guardar(this.desenhoS, erroM / velocidadeMs);
  }

  /** As duas estimativas para o mesmo ônibus, no mesmo instante. */
  registrarComparacao(onibus: string, nossaMin: number, nubusMin: number, agora: number): void {
    if (!Number.isFinite(nossaMin) || !Number.isFinite(nubusMin)) return;
    const ultima = this.ultimaComparacao.get(onibus);
    if (ultima !== undefined && agora - ultima < INTERVALO_COMPARACAO_MS) return;
    this.ultimaComparacao.set(onibus, agora);
    guardar(this.comparacoes, nossaMin - nubusMin);
  }

  resumo(): ResumoDiagnostico {
    const um = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
    return {
      desenho: {
        amostras: this.desenhoM.length,
        medianaM: um(mediana(this.desenhoM)),
        medianaS: um(mediana(this.desenhoS)),
        atrasPct: this.desenhoM.length
          ? Math.round((100 * this.desenhoM.filter((m) => m < 0).length) / this.desenhoM.length)
          : null,
      },
      comparacao: {
        amostras: this.comparacoes.length,
        medianaMin: um(mediana(this.comparacoes)),
        mediaAbsMin: this.comparacoes.length
          ? um(this.comparacoes.reduce((a, d) => a + Math.abs(d), 0) / this.comparacoes.length)
          : null,
      },
    };
  }
}

/** Um só coletor para o app inteiro. */
export const diagnostico = new Diagnostico();

function guardar(lista: number[], valor: number): void {
  lista.push(valor);
  if (lista.length > MAX_AMOSTRAS) lista.shift();
}

function mediana(valores: number[]): number | null {
  if (!valores.length) return null;
  const ord = [...valores].sort((a, b) => a - b);
  const meio = ord.length >> 1;
  return ord.length % 2 ? ord[meio] : (ord[meio - 1] + ord[meio]) / 2;
}
