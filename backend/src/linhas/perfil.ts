import type { TrechosDto } from './linha.dto.js';

/**
 * Tempo de viagem ao longo do traçado pela velocidade de cada trecho: a
 * mesma conta do frontend (`frontend/src/app/mapa/dead-reckoning/
 * perfil-velocidade.ts`), para o placar medir a previsão que o app mostra.
 */
export const VELOCIDADE_PADRAO_KMH = 18;
const MINIMA_MS = 5 / 3.6;
const MAXIMA_MS = 60 / 3.6;

export function segundosEntre(
  trechos: TrechosDto | undefined,
  de: number,
  ate: number,
): number {
  if (ate <= de) return 0;
  const padraoMs = limitar((trechos?.mediaKmh ?? VELOCIDADE_PADRAO_KMH) / 3.6);
  const tam = trechos?.tamanhoM;
  if (!trechos || !tam) return (ate - de) / padraoMs;

  let segundos = 0;
  let s = de;
  while (s < ate) {
    const fim = Math.min(ate, (Math.floor(s / tam) + 1) * tam);
    const kmh = trechos.kmh[Math.floor(Math.max(0, s) / tam)];
    segundos += (fim - s) / (kmh == null ? padraoMs : limitar(kmh / 3.6));
    s = fim;
  }
  return segundos;
}

function limitar(ms: number): number {
  return Math.max(MINIMA_MS, Math.min(MAXIMA_MS, ms));
}
