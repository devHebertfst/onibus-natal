import { Trechos } from '../../core/linha.models';

/**
 * Velocidade média de um ônibus urbano contando paradas, semáforos e
 * trânsito. Só vale enquanto a linha ainda não tem velocidade medida.
 */
export const VELOCIDADE_PADRAO_KMH = 18;
/** Limites da velocidade usada nas contas: protege de medidas extremas. */
const MINIMA_MS = 5 / 3.6;
const MAXIMA_MS = 60 / 3.6;

/**
 * Velocidade ao longo do traçado de um itinerário, trecho a trecho, como os
 * próprios ônibus da linha a mediram nos últimos minutos (ver `TrechosDto`).
 * Onde nenhum ônibus passou, vale a média da linha; sem média, 18 km/h.
 *
 * A velocidade de cada trecho já conta o tempo parado, então somar o tempo
 * de cada trecho dá o tempo de viagem.
 */
export class PerfilVelocidade {
  /** true se ao menos parte da conta vem de medidas dos ônibus. */
  readonly medido: boolean;
  private readonly padraoMs: number;

  constructor(private readonly trechos?: Trechos) {
    this.medido = !!trechos && (trechos.mediaKmh !== null || trechos.kmh.some((k) => k !== null));
    this.padraoMs = limitar((trechos?.mediaKmh ?? VELOCIDADE_PADRAO_KMH) / 3.6);
  }

  /** Velocidade (m/s) a `s` metros do início do traçado. */
  velocidadeEm(s: number): number {
    const t = this.trechos;
    const kmh = t?.kmh[Math.floor(Math.max(0, s) / t.tamanhoM)];
    return kmh == null ? this.padraoMs : limitar(kmh / 3.6);
  }

  /** Segundos para ir de `de` até `ate` (metros ao longo do traçado). */
  segundosEntre(de: number, ate: number): number {
    if (ate <= de) return 0;
    const tam = this.trechos?.tamanhoM;
    if (!tam) return (ate - de) / this.padraoMs;

    let segundos = 0;
    let s = de;
    while (s < ate) {
      const fim = Math.min(ate, (Math.floor(s / tam) + 1) * tam);
      segundos += (fim - s) / this.velocidadeEm(s);
      s = fim;
    }
    return segundos;
  }
}

function limitar(ms: number): number {
  return Math.max(MINIMA_MS, Math.min(MAXIMA_MS, ms));
}
