import { coordenadaValida, toNumber } from '../nubus/nubus.parse.js';
import type { LocalTrajetoDto, TrechoDto, ViagemDto } from './trajeto.dto.js';

type Objeto = Record<string, unknown>;
const objeto = (v: unknown): Objeto =>
  v !== null && typeof v === 'object' ? (v as Objeto) : {};
const texto = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

/** Polylines Google, precisão 5, como as geometrias do OpenTripPlanner. */
export function decodificarPolyline(codificada: string): [number, number][] {
  const pontos: [number, number][] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const delta = (): number => {
    let valor = 0;
    let bits = 0;
    while (i < codificada.length && bits <= 30) {
      const b = codificada.charCodeAt(i++) - 63;
      if (b < 0 || b > 63) throw new Error('Polyline inválida');
      valor |= (b & 31) << bits;
      if (b < 32) return valor & 1 ? ~(valor >>> 1) : valor >>> 1;
      bits += 5;
    }
    throw new Error('Polyline incompleta');
  };
  while (i < codificada.length) {
    lat += delta();
    lng += delta();
    const ponto: [number, number] = [lat / 100_000, lng / 100_000];
    if (!coordenadaValida(...ponto)) throw new Error('Coordenada inválida');
    pontos.push(ponto);
  }
  return pontos;
}

function local(v: unknown): LocalTrajetoDto {
  const p = objeto(v);
  const lat = toNumber(p.lat);
  const lng = toNumber(p.lon ?? p.lng);
  if (!coordenadaValida(lat, lng)) throw new Error('Local inválido');
  const nome = texto(p.name);
  return {
    lat,
    lng,
    nome:
      nome === 'Origin' || nome === 'Destination'
        ? 'Ponto no mapa'
        : (nome ?? 'Ponto no mapa'),
  };
}

function instante(v: unknown): number {
  const ms =
    typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  if (!Number.isFinite(ms) || !Number.isFinite(new Date(ms).getTime()))
    throw new Error('Horário inválido');
  return ms;
}

/** Aceita a resposta direta da Nubus e o envelope `plan` do OTP. */
export function parseTrajetos(dados: unknown): ViagemDto[] {
  const raiz = objeto(dados);
  const lista = raiz.itineraries ?? objeto(raiz.plan).itineraries;
  if (!Array.isArray(lista)) throw new Error('Resposta do planejador inválida');
  const viagens: ViagemDto[] = [];
  for (const bruto of lista) {
    try {
      const viagem = objeto(bruto);
      if (!Array.isArray(viagem.legs) || viagem.legs.length === 0) continue;
      const trechos = viagem.legs.map((v): TrechoDto => {
        const t = objeto(v);
        if (t.mode !== 'WALK' && t.mode !== 'BUS')
          throw new Error('Modo não suportado');
        const inicio = instante(t.startTime);
        const fim = instante(t.endTime);
        if (fim < inicio) throw new Error('Horários fora de ordem');
        const metros = toNumber(t.distance);
        if (!Number.isFinite(metros) || metros < 0)
          throw new Error('Distância inválida');
        const partida = local(t.from);
        const chegada = local(t.to);
        const geometria = texto(objeto(t.legGeometry).points);
        const rota = objeto(t.route ?? objeto(t.trip).route);
        return {
          modo: t.mode,
          inicio: new Date(inicio).toISOString(),
          fim: new Date(fim).toISOString(),
          duracaoSegundos: Math.round((fim - inicio) / 1000),
          metros: Math.round(metros),
          linha:
            t.mode === 'BUS'
              ? (texto(rota.shortName) ??
                texto(t.routeShortName) ??
                texto(t.route))
              : null,
          letreiro:
            t.mode === 'BUS'
              ? (texto(objeto(t.trip).tripHeadsign) ??
                texto(t.headsign) ??
                texto(rota.longName))
              : null,
          partida,
          chegada,
          tracado: geometria ? decodificarPolyline(geometria) : [],
        };
      });
      const inicio = instante(trechos[0].inicio);
      const fim = instante(trechos.at(-1)!.fim);
      if (
        trechos.some(
          (t, i) => i > 0 && instante(t.inicio) < instante(trechos[i - 1].fim),
        )
      )
        throw new Error('Trechos fora de ordem');
      viagens.push({
        inicio: new Date(inicio).toISOString(),
        fim: new Date(fim).toISOString(),
        duracaoSegundos: Math.round((fim - inicio) / 1000),
        caminhadaMetros: trechos
          .filter((t) => t.modo === 'WALK')
          .reduce((s, t) => s + t.metros, 0),
        trechos,
      });
    } catch {
      // Uma alternativa quebrada não esconde as outras alternativas válidas.
    }
  }
  if (lista.length > 0 && viagens.length === 0)
    throw new Error('Nenhum trajeto válido na resposta');
  return viagens
    .sort((a, b) => Date.parse(a.fim) - Date.parse(b.fim))
    .slice(0, 5);
}
