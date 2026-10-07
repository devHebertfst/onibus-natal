import type { LatLng } from '../linhas/geo.js';
import type { NubusCarro, NubusParada } from './nubus.types.js';

/** Aceita número ou string (com vírgula ou ponto decimal). */
export function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v.trim().replace(',', '.'));
  return NaN;
}

/** Coordenada plausível (descarta 0,0 e valores vazios que a API às vezes manda). */
export function coordenadaValida(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

/** Converte "lat long|lat long|..." em lista de coordenadas. */
export function parsePontos(pontos: string | null | undefined): LatLng[] {
  if (!pontos) return [];
  const resultado: LatLng[] = [];
  for (const par of pontos.split('|')) {
    const [lat, lng] = par.trim().split(/\s+/).map(toNumber);
    if (!coordenadaValida(lat, lng)) continue;
    const anterior = resultado.at(-1);
    // Pontos repetidos geram segmentos de comprimento zero no frontend.
    if (anterior && anterior.lat === lat && anterior.lng === lng) continue;
    resultado.push({ lat, lng });
  }
  return resultado;
}

export interface Parada extends LatLng {
  codigo: string;
  descricao: string;
  ordem: number;
}

export function parseParadas(
  paradas: NubusParada[] | null | undefined,
): Parada[] {
  return (paradas ?? [])
    .map((p) => ({
      codigo: String(p.codigo),
      descricao: (p.descricao ?? '').trim(),
      ordem: toNumber(p.ordem),
      lat: toNumber(p.Lat),
      lng: toNumber(p.Long),
    }))
    .filter((p) => coordenadaValida(p.lat, p.lng))
    .sort((a, b) => a.ordem - b.ordem);
}

export interface Carro extends LatLng {
  id: string;
}

export function parseCarros(carros: NubusCarro[] | null | undefined): Carro[] {
  return (carros ?? [])
    .map((c) => ({
      id: String(c.carro).trim(),
      lat: toNumber(c.Lat),
      lng: toNumber(c.Long),
    }))
    .filter((c) => c.id !== '' && coordenadaValida(c.lat, c.lng));
}
