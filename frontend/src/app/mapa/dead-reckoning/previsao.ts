import { Parada } from '../../core/linha.models';
import { Frota } from './frota';
import { Rota } from './rota';

/**
 * Velocidade média de um ônibus urbano contando paradas, semáforos e
 * trânsito. A velocidade instantânea engana (um ônibus a 40 km/h agora vai
 * parar no próximo ponto), então a previsão usa a média comercial.
 */
export const VELOCIDADE_COMERCIAL_KMH = 18;
/** Um pouco depois da parada ainda conta como "chegando" (ruído de GPS). */
const TOLERANCIA_PASSOU_M = 30;

export interface Previsao {
  onibus: string;
  /** Distância pelo traçado até a parada (m). */
  metros: number;
  /** Estimativa em minutos, pela velocidade comercial. */
  minutos: number;
}

const cacheParadas = new WeakMap<Rota, Map<string, number>>();

/**
 * Posição `s` de cada parada no traçado. Projeta em ordem, usando a parada
 * anterior como dica, para não confundir trechos em que o traçado passa duas
 * vezes pela mesma rua.
 */
export function sDasParadas(rota: Rota, paradas: Parada[]): Map<string, number> {
  let cache = cacheParadas.get(rota);
  if (cache) return cache;
  cache = new Map();
  let dica: number | undefined;
  for (const p of [...paradas].sort((a, b) => a.ordem - b.ordem)) {
    dica = rota.projetar(p.lat, p.lng, dica).s;
    cache.set(p.codigo, dica);
  }
  cacheParadas.set(rota, cache);
  return cache;
}

/** Ônibus que ainda vão passar pela parada neste itinerário, do mais próximo ao mais longe. */
export function preverChegadas(
  frota: Frota,
  itinerario: string,
  paradas: Parada[],
  codigoParada: string,
): Previsao[] {
  const rota = frota.rota(itinerario);
  if (!rota) return [];
  const sParada = sDasParadas(rota, paradas).get(codigoParada);
  if (sParada === undefined) return [];

  const ms = VELOCIDADE_COMERCIAL_KMH / 3.6;
  const previsoes: Previsao[] = [];
  for (const animado of frota.onibus.values()) {
    const pos = animado.posicaoNaRota();
    if (!pos || pos.codigo !== itinerario) continue;
    const falta = sParada - pos.s;
    if (falta < -TOLERANCIA_PASSOU_M) continue;
    const metros = Math.max(0, falta);
    previsoes.push({ onibus: animado.id, metros, minutos: metros / ms / 60 });
  }
  return previsoes.sort((a, b) => a.metros - b.metros);
}
