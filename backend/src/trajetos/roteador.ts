import { haversine, type LatLng } from '../linhas/geo.js';

/** Parada de um itinerário, na ordem em que o ônibus passa. */
export interface ParadaMalha extends LatLng {
  codigo: string;
  descricao: string;
}

/** Um itinerário (sentido de uma linha) com as paradas em ordem e o traçado. */
export interface ItinerarioMalha {
  numero: string;
  codigo: string;
  descricao: string;
  codigolinha: string;
  paradas: ParadaMalha[];
  tracado: LatLng[];
}

/** Um ônibus da rota: embarca na parada `embarque` e desce na `desembarque` (índices). */
export interface PernaOnibus {
  itinerario: ItinerarioMalha;
  embarque: number;
  desembarque: number;
}

export interface Rota {
  pernas: PernaOnibus[];
  /** Estimativa usada só para escolher as melhores (s). */
  custoS: number;
}

/** A rua não é reta: a distância a pé é a linha reta vezes este fator. */
export const FATOR_DESVIO = 1.3;
/** Passo de quem anda com pressa moderada (m/s). */
export const VELOCIDADE_PE = 1.2;
/** Ônibus urbano em Natal, contando as paradas e o trânsito (m/s, ~16 km/h). */
export const VELOCIDADE_ONIBUS = 16 / 3.6;
/** Espera estimada quando não há previsão para o ponto. */
export const ESPERA_ESTIMADA_S = 8 * 60;
/** Trocar de ônibus custa mais que o tempo de andar: incerteza e incômodo. */
const PENALIDADE_BALDEACAO_S = 4 * 60;
/** Quanto se anda até a primeira parada ou da última até o destino. */
const RAIOS_PE_M = [900, 1600];
/** Andar entre a parada onde desce e a do segundo ônibus. */
const RAIO_BALDEACAO_M = 350;
/** Por parada, quantas opções de cada lado guardar para combinar. */
const OPCOES_POR_PARADA = 4;
const MAX_ROTAS = 6;

export function metrosPe(a: LatLng, b: LatLng): number {
  return haversine(a, b) * FATOR_DESVIO;
}

export function segundosPe(a: LatLng, b: LatLng): number {
  return metrosPe(a, b) / VELOCIDADE_PE;
}

const acumulados = new WeakMap<ItinerarioMalha, number[]>();

/** Distância percorrida pelo ônibus da primeira parada até cada uma (m). */
export function distanciasAcumuladas(it: ItinerarioMalha): number[] {
  let cum = acumulados.get(it);
  if (!cum) {
    cum = [0];
    for (let i = 1; i < it.paradas.length; i++)
      cum.push(cum[i - 1] + haversine(it.paradas[i - 1], it.paradas[i]));
    acumulados.set(it, cum);
  }
  return cum;
}

interface Lado {
  t: number;
  it: ItinerarioMalha;
  /** Primeiro ônibus: onde embarcou; segundo: onde desce. */
  ponta: number;
  /** Índice da parada da baldeação neste itinerário. */
  meio: number;
}

/**
 * Rotas de ônibus de `origem` a `destino`: diretas e com uma baldeação. A
 * conta é por tempo estimado (a pé + espera + viagem), sem horários; quem
 * chama refina com a previsão da Nubus.
 */
export function planejarRotas(
  malha: ItinerarioMalha[],
  origem: LatLng,
  destino: LatLng,
): Rota[] {
  for (const raio of RAIOS_PE_M) {
    const rotas = [...diretas(malha, origem, destino, raio)];
    const melhorDireta = Math.min(...rotas.map((r) => r.custoS));
    rotas.push(
      ...comBaldeacao(malha, origem, destino, raio).filter(
        // Baldeação só quando ganha tempo de verdade sobre o ônibus direto.
        (r) => r.custoS < melhorDireta - 5 * 60,
      ),
    );
    if (rotas.length) return escolher(rotas);
  }
  return [];
}

function diretas(
  malha: ItinerarioMalha[],
  origem: LatLng,
  destino: LatLng,
  raio: number,
): Rota[] {
  const rotas: Rota[] = [];
  for (const it of malha) {
    const cum = distanciasAcumuladas(it);
    let melhorEmbarque = -1;
    let valorEmbarque = Infinity;
    let melhor: Rota | null = null;
    for (let j = 0; j < it.paradas.length; j++) {
      const p = it.paradas[j];
      if (melhorEmbarque >= 0 && metrosPe(p, destino) <= raio) {
        const custoS =
          valorEmbarque +
          cum[j] / VELOCIDADE_ONIBUS +
          segundosPe(p, destino) +
          ESPERA_ESTIMADA_S;
        if (!melhor || custoS < melhor.custoS)
          melhor = {
            custoS,
            pernas: [
              { itinerario: it, embarque: melhorEmbarque, desembarque: j },
            ],
          };
      }
      if (metrosPe(origem, p) <= raio) {
        const valor = segundosPe(origem, p) - cum[j] / VELOCIDADE_ONIBUS;
        if (valor < valorEmbarque) {
          valorEmbarque = valor;
          melhorEmbarque = j;
        }
      }
    }
    if (melhor) rotas.push(melhor);
  }
  return rotas;
}

function comBaldeacao(
  malha: ItinerarioMalha[],
  origem: LatLng,
  destino: LatLng,
  raio: number,
): Rota[] {
  // Primeiro ônibus: até onde dá para chegar, e em quanto tempo, saindo da origem.
  const ida = new Map<string, Lado[]>();
  // Segundo ônibus: de onde dá para pegar um que chega perto do destino.
  const volta = new Map<string, Lado[]>();
  const paradaPor = new Map<string, ParadaMalha>();

  for (const it of malha) {
    const cum = distanciasAcumuladas(it);
    let embarque = -1;
    let valor = Infinity;
    for (let k = 0; k < it.paradas.length; k++) {
      const p = it.paradas[k];
      if (embarque >= 0)
        guardar(ida, p, paradaPor, {
          t: valor + cum[k] / VELOCIDADE_ONIBUS + ESPERA_ESTIMADA_S,
          it,
          ponta: embarque,
          meio: k,
        });
      if (metrosPe(origem, p) <= raio) {
        const v = segundosPe(origem, p) - cum[k] / VELOCIDADE_ONIBUS;
        if (v < valor) {
          valor = v;
          embarque = k;
        }
      }
    }

    let desce = -1;
    let valorDesce = Infinity;
    for (let k = it.paradas.length - 1; k >= 0; k--) {
      const p = it.paradas[k];
      if (desce >= 0)
        guardar(volta, p, paradaPor, {
          t: valorDesce - cum[k] / VELOCIDADE_ONIBUS + ESPERA_ESTIMADA_S,
          it,
          ponta: desce,
          meio: k,
        });
      if (metrosPe(p, destino) <= raio) {
        const v = cum[k] / VELOCIDADE_ONIBUS + segundosPe(p, destino);
        if (v < valorDesce) {
          valorDesce = v;
          desce = k;
        }
      }
    }
  }

  // Paradas do segundo ônibus numa grade de ~330 m, para achar as vizinhas rápido.
  const celula = (p: LatLng) =>
    `${Math.floor(p.lat / 0.003)}:${Math.floor(p.lng / 0.003)}`;
  const grade = new Map<string, ParadaMalha[]>();
  for (const codigo of volta.keys()) {
    const p = paradaPor.get(codigo)!;
    const c = celula(p);
    let lista = grade.get(c);
    if (!lista) grade.set(c, (lista = []));
    lista.push(p);
  }

  const melhores = new Map<string, Rota>();
  for (const [codigo, primeiros] of ida) {
    const s = paradaPor.get(codigo)!;
    const [ci, cj] = [Math.floor(s.lat / 0.003), Math.floor(s.lng / 0.003)];
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++)
        for (const s2 of grade.get(`${ci + di}:${cj + dj}`) ?? []) {
          const andar = metrosPe(s, s2);
          if (andar > RAIO_BALDEACAO_M) continue;
          for (const a of primeiros)
            for (const b of volta.get(s2.codigo)!) {
              if (a.it.numero === b.it.numero) continue;
              const custoS =
                a.t + andar / VELOCIDADE_PE + PENALIDADE_BALDEACAO_S + b.t;
              const chave = `${a.it.numero}>${b.it.numero}`;
              const atual = melhores.get(chave);
              if (atual && atual.custoS <= custoS) continue;
              melhores.set(chave, {
                custoS,
                pernas: [
                  { itinerario: a.it, embarque: a.ponta, desembarque: a.meio },
                  { itinerario: b.it, embarque: b.meio, desembarque: b.ponta },
                ],
              });
            }
        }
  }
  return [...melhores.values()];
}

function guardar(
  mapa: Map<string, Lado[]>,
  p: ParadaMalha,
  paradaPor: Map<string, ParadaMalha>,
  lado: Lado,
): void {
  paradaPor.set(p.codigo, p);
  let lista = mapa.get(p.codigo);
  if (!lista) mapa.set(p.codigo, (lista = []));
  const mesmo = lista.findIndex((l) => l.it.numero === lado.it.numero);
  if (mesmo >= 0) {
    if (lista[mesmo].t <= lado.t) return;
    lista.splice(mesmo, 1);
  }
  lista.push(lado);
  lista.sort((a, b) => a.t - b.t);
  if (lista.length > OPCOES_POR_PARADA) lista.pop();
}

/**
 * As melhores, sem repetir a mesma combinação de linhas nem as muito piores,
 * e no máximo duas começando pelo mesmo ônibus (senão a lista vira o mesmo
 * trajeto trocando só o segundo ônibus).
 */
function escolher(rotas: Rota[]): Rota[] {
  rotas.sort((a, b) => a.custoS - b.custoS);
  const limite = rotas[0].custoS * 1.6 + 10 * 60;
  const vistas = new Set<string>();
  const porPrimeira = new Map<string, number>();
  const escolhidas: Rota[] = [];
  for (const r of rotas) {
    const chave = r.pernas.map((p) => p.itinerario.numero).join('>');
    const primeira =
      r.pernas.length > 1 ? r.pernas[0].itinerario.numero : chave;
    const usadas = porPrimeira.get(primeira) ?? 0;
    if (r.custoS > limite || vistas.has(chave) || usadas >= 2) continue;
    vistas.add(chave);
    porPrimeira.set(primeira, usadas + 1);
    escolhidas.push(r);
    if (escolhidas.length === MAX_ROTAS) break;
  }
  return escolhidas;
}

/**
 * Pedaço do traçado entre duas paradas. Sem traçado (ou se ele não passa
 * perto delas), liga as paradas do caminho em ordem.
 */
export function tracadoEntre(perna: PernaOnibus): [number, number][] {
  const { itinerario: it, embarque, desembarque } = perna;
  const a = it.paradas[embarque];
  const b = it.paradas[desembarque];
  const pelasParadas = it.paradas
    .slice(embarque, desembarque + 1)
    .map((p): [number, number] => [p.lat, p.lng]);
  const t = it.tracado;
  if (t.length < 2) return pelasParadas;
  const maisPerto = (alvo: LatLng, de: number) => {
    let melhor = -1;
    let dist = Infinity;
    for (let i = de; i < t.length; i++) {
      const d = haversine(alvo, t[i]);
      if (d < dist) {
        dist = d;
        melhor = i;
      }
    }
    return { i: melhor, dist };
  };
  const ia = maisPerto(a, 0);
  const ib = maisPerto(b, ia.i);
  if (ia.dist > 150 || ib.dist > 150 || ib.i <= ia.i) return pelasParadas;
  return [
    [a.lat, a.lng],
    ...t.slice(ia.i, ib.i + 1).map((p): [number, number] => [p.lat, p.lng]),
    [b.lat, b.lng],
  ];
}
