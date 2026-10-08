import type { LatLng } from '../linhas/geo.js';
import type {
  NubusCarro,
  NubusParada,
  NubusParadaCidade,
  NubusPrevisao,
} from './nubus.types.js';

/** Aceita número ou string (com vírgula ou ponto decimal). */
export function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim())
    return Number(v.trim().replace(',', '.'));
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

export interface ParadaCidade extends LatLng {
  codigo: string;
  /** Endereço completo, como vem da API. */
  descricao: string;
}

export function parseParadasCidade(
  paradas: NubusParadaCidade[] | null | undefined,
): ParadaCidade[] {
  return (paradas ?? [])
    .map((p) => ({
      codigo: String(p.codigo ?? '').trim(),
      descricao: (p.descricao ?? p.apelido ?? '').trim(),
      lat: toNumber(p.Lat),
      lng: toNumber(p.Long),
    }))
    .filter((p) => p.codigo !== '' && coordenadaValida(p.lat, p.lng));
}

/** Natal não tem horário de verão: UTC−3 o ano todo. */
const FUSO_NATAL = '-03:00';

/** Preserva fusos explícitos e lê os horários sem fuso como hora de Natal. */
function horarioNubus(valor: string | null | undefined): number {
  if (!valor) return NaN;
  const normalizado = valor.trim().replace(/(\.\d{3})\d+/, '$1');
  return Date.parse(
    /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalizado)
      ? normalizado
      : normalizado + FUSO_NATAL,
  );
}

export interface Chegada {
  /** Veículo; null nas viagens da tabela (sem GPS). */
  onibus: string | null;
  /** true: ônibus com GPS; false: horário programado. */
  aoVivo: boolean;
  /** Horário previsto (ms desde a época). */
  chegaEm: number;
  /** Distância do ônibus até a parada (m); null nas viagens da tabela. */
  metros: number | null;
  /** Horário da posição de GPS usada na conta; null nas viagens da tabela. */
  gpsEm: number | null;
}

/**
 * Converte a previsão da Nubus. O horário previsto vem em hora local sem
 * fuso e com 7 casas de fração ("2026-10-07T19:34:28.0000001"); se não der
 * para ler, usa `agora + Minutos`.
 */
export function parsePrevisoes(
  previsoes: NubusPrevisao[] | null | undefined,
  agora: number,
): Chegada[] {
  const chegadas: Chegada[] = [];
  for (const p of previsoes ?? []) {
    const aoVivo = (p.tipo ?? '').toLowerCase() === 'on-line';
    const carro = String(p.Carro ?? '').trim();
    if (aoVivo && carro === '') continue;

    let chegaEm = horarioNubus(p.PrevisaoDeChegada);
    if (!Number.isFinite(chegaEm)) {
      const minutos = toNumber(p.Minutos);
      if (!Number.isFinite(minutos)) continue;
      chegaEm = agora + minutos * 60_000;
    }

    const metros = toNumber(p.distanciaVeiculoMetros);
    const gpsEm = horarioNubus(p.gpsVeiculoData);
    chegadas.push({
      onibus: aoVivo ? carro : null,
      aoVivo,
      chegaEm,
      metros: aoVivo && Number.isFinite(metros) ? Math.round(metros) : null,
      gpsEm: aoVivo && Number.isFinite(gpsEm) ? gpsEm : null,
    });
  }
  return chegadas.sort((a, b) => a.chegaEm - b.chegaEm);
}
