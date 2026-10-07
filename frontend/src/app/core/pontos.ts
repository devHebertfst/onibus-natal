import { Itinerario, Parada } from './linha.models';
import { nomeParada } from './texto';

/** Paradas de sentidos diferentes a menos disso são o mesmo ponto para o passageiro. */
const RAIO_MESMO_PONTO_M = 45;

/** Uma parada de um itinerário (um sentido). */
export interface ParadaNoSentido {
  itinerario: string;
  parada: Parada;
}

/**
 * Ponto físico: onde o passageiro espera. Junta as paradas de ida e volta que
 * ficam no mesmo lugar (lados opostos da rua), para o mapa ter um alvo só e a
 * placa mostrar os dois sentidos — em vez de o passageiro tocar na parada
 * "errada" e ver "nenhum ônibus a caminho".
 */
export interface PontoFisico {
  /** `itinerario|codigo` da primeira parada do grupo. */
  chave: string;
  nome: string;
  lat: number;
  lng: number;
  /** Uma entrada por sentido, na ordem dos itinerários da linha. */
  sentidos: ParadaNoSentido[];
}

export function chaveParada(itinerario: string, codigo: string): string {
  return `${itinerario}|${codigo}`;
}

let cache: { assinatura: string; pontos: PontoFisico[] } | null = null;

export function agruparParadas(itinerarios: Itinerario[]): PontoFisico[] {
  const assinatura = itinerarios
    .map((i) => `${i.codigo}:${i.paradas.length}:${i.paradas[0]?.codigo ?? ''}`)
    .join(';');
  if (cache?.assinatura === assinatura) return cache.pontos;

  const pontos: PontoFisico[] = [];
  for (const it of itinerarios) {
    for (const parada of [...it.paradas].sort((a, b) => a.ordem - b.ordem)) {
      const perto = pontos.find(
        (p) =>
          !p.sentidos.some((s) => s.itinerario === it.codigo) &&
          distanciaM(p.lat, p.lng, parada.lat, parada.lng) <= RAIO_MESMO_PONTO_M,
      );
      if (perto) {
        perto.sentidos.push({ itinerario: it.codigo, parada });
        continue;
      }
      // Uma linha circular pode passar duas vezes na mesma parada: fica a 1ª.
      const repetida = pontos.find((p) =>
        p.sentidos.some((s) => s.itinerario === it.codigo && s.parada.codigo === parada.codigo),
      );
      if (repetida) continue;
      pontos.push({
        chave: chaveParada(it.codigo, parada.codigo),
        nome: nomeParada(parada.descricao) || `Parada ${parada.codigo}`,
        lat: parada.lat,
        lng: parada.lng,
        sentidos: [{ itinerario: it.codigo, parada }],
      });
    }
  }
  cache = { assinatura, pontos };
  return pontos;
}

/** Ponto que contém a parada `codigo` (aceita a chave `itinerario|codigo` ou só o código). */
export function acharPonto(pontos: PontoFisico[], ref: string): PontoFisico | undefined {
  const [a, b] = ref.includes('|') ? ref.split('|') : [null, ref];
  return pontos.find((p) =>
    p.sentidos.some((s) => s.parada.codigo === b && (a === null || s.itinerario === a)),
  );
}

export interface PontoProximo {
  ponto: PontoFisico;
  metros: number;
}

/** Os pontos mais perto de uma posição, em linha reta. */
export function pontosProximos(
  pontos: PontoFisico[],
  lat: number,
  lng: number,
  quantos = 3,
): PontoProximo[] {
  return pontos
    .map((ponto) => ({ ponto, metros: distanciaM(lat, lng, ponto.lat, ponto.lng) }))
    .sort((a, b) => a.metros - b.metros)
    .slice(0, quantos);
}

/** Distância aproximada em metros (equiretangular; ótima na escala de uma cidade). */
export function distanciaM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const k = 111_195;
  const kx = k * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return Math.hypot((lng2 - lng1) * kx, (lat2 - lat1) * k);
}
