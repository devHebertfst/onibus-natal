import { config } from '../config.js';
import type { LatLng } from './geo.js';
import type { RotaMetros } from './rota.js';

/**
 * A cidade em pedaços de rua: uma grade de ~150 m de lado. Com o sentido de
 * circulação (8 rumos de 45°), ida e volta na mesma rua não se misturam.
 * É o que liga linhas diferentes que passam pelo mesmo lugar.
 */

/** Pedaço da grade num rumo: "i:j:r". */
export type Celula = string;

const PASSO_M = 50;

/** Pedaço da grade (sem rumo) de um ponto: "i:j". */
export function quadra(p: LatLng, lado = config.transito.celulaGraus): string {
  return `${Math.floor(p.lat / lado)}:${Math.floor(p.lng / lado)}`;
}

/** Rumo (graus) em um dos 8 setores de 45°. */
export function setor(rumo: number): number {
  return Math.round(rumo / 45) % 8;
}

/** Pedaços de rua (com o rumo) por onde o traçado passa entre `s0` e `s1`. */
export function celulasEntre(
  rota: RotaMetros,
  s0: number,
  s1: number,
  lado = config.transito.celulaGraus,
): Celula[] {
  const vistas = new Set<Celula>();
  for (let s = s0; s < s1; s += PASSO_M) {
    const meio = Math.min(s1, s + PASSO_M / 2);
    vistas.add(
      `${quadra(rota.pontoEm(meio), lado)}:${setor(rota.rumoEm(meio))}`,
    );
  }
  return [...vistas];
}

/** Mesmo pedaço nos rumos vizinhos (±45°): curvas e ruído de traçado. */
export function vizinhasDeRumo(celula: Celula): Celula[] {
  const k = celula.lastIndexOf(':');
  const base = celula.slice(0, k);
  const r = Number(celula.slice(k + 1));
  return [r, (r + 7) % 8, (r + 1) % 8].map((x) => `${base}:${x}`);
}

/** Pedaços da grade (sem rumo) por onde um traçado passa. */
export function quadrasDoTracado(
  tracado: LatLng[],
  lado = config.transito.celulaGraus,
): Set<string> {
  const vistas = new Set<string>();
  const graus = (PASSO_M / 111_195) * 0.9;
  for (let i = 0; i < tracado.length; i++) {
    const a = tracado[i];
    vistas.add(quadra(a, lado));
    const b = tracado[i + 1];
    if (!b) break;
    const passos = Math.ceil(
      Math.max(Math.abs(b.lat - a.lat), Math.abs(b.lng - a.lng)) / graus,
    );
    for (let k = 1; k < passos; k++) {
      const t = k / passos;
      vistas.add(
        quadra(
          {
            lat: a.lat + (b.lat - a.lat) * t,
            lng: a.lng + (b.lng - a.lng) * t,
          },
          lado,
        ),
      );
    }
  }
  return vistas;
}
