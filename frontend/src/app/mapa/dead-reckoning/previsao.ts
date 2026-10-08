import { Parada } from '../../core/linha.models';
import { Frota } from './frota';
import { VELOCIDADE_COMERCIAL_KMH } from './onibus-animado';
import { Rota } from './rota';

/** Um pouco depois da parada ainda conta como "chegando" (ruído de GPS). */
const TOLERANCIA_PASSOU_M = 30;
/** Paradas a menos disso do ônibus ou do destino não contam como "no caminho". */
const MARGEM_PARADA_M = 15;

export interface Previsao {
  onibus: string;
  /** Distância pelo traçado até a parada (m). */
  metros: number | null;
  /** Minutos até a parada (estimativa própria ou previsão da Nubus). */
  minutos: number;
  /** Paradas entre o ônibus e a parada do passageiro; null se só a Nubus vê o ônibus. */
  paradas: number | null;
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
    if (!cache.has(p.codigo)) cache.set(p.codigo, dica);
  }
  cacheParadas.set(rota, cache);
  return cache;
}

/** Rumo do traçado na parada (graus, 0 = norte), para a seta da placa. */
export function rumoNaParada(frota: Frota, itinerario: string, paradas: Parada[], codigo: string) {
  const rota = frota.rota(itinerario);
  const s = rota ? sDasParadas(rota, paradas).get(codigo) : undefined;
  return rota && s !== undefined ? rota.rumoEm(s) : null;
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
  const sPorParada = sDasParadas(rota, paradas);
  const sParada = sPorParada.get(codigoParada);
  if (sParada === undefined) return [];
  const todas = [...sPorParada.values()];

  const ms = VELOCIDADE_COMERCIAL_KMH / 3.6;
  const previsoes: Previsao[] = [];
  for (const animado of frota.onibus.values()) {
    const pos = animado.posicaoNaRota();
    if (!pos || pos.codigo !== itinerario) continue;
    const falta = sParada - pos.s;
    if (falta < -TOLERANCIA_PASSOU_M) continue;
    const metros = Math.max(0, falta);
    const noCaminho = todas.filter(
      (s) => s > pos.s + MARGEM_PARADA_M && s < sParada - MARGEM_PARADA_M,
    ).length;
    previsoes.push({ onibus: animado.id, metros, minutos: metros / ms / 60, paradas: noCaminho });
  }
  return previsoes.sort((a, b) => a.minutos - b.minutos);
}
