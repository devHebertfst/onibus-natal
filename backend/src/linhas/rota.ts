import type { LatLng } from './geo.js';

/**
 * Traçado de um itinerário em metros, para saber onde um ônibus está ao longo
 * dele (`s`, a distância desde o início). Mesma conta do frontend
 * (`frontend/src/app/mapa/dead-reckoning/rota.ts`): projeção equiretangular
 * centrada na média dos pontos. Os dois lados precisam medir `s` igual, porque
 * as velocidades por trecho calculadas aqui são lidas lá pelo mesmo `s`.
 */
const METROS_POR_GRAU = 111_195;
/** Com dica, trechos quase tão próximos quanto o melhor também concorrem. */
const TOLERANCIA_DICA_M = 25;

export interface Projecao {
  /** Distância ao longo do traçado (m). */
  s: number;
  /** Distância do ponto até o traçado (m). */
  distancia: number;
}

export class RotaMetros {
  readonly comprimento: number;
  private readonly x: Float64Array;
  private readonly y: Float64Array;
  private readonly acumulado: Float64Array;
  private readonly lat0: number;
  private readonly lng0: number;
  private readonly kx: number;

  constructor(pontos: [number, number][]) {
    const n = pontos.length;
    this.lat0 = pontos.reduce((a, p) => a + p[0], 0) / n;
    this.lng0 = pontos.reduce((a, p) => a + p[1], 0) / n;
    this.kx = METROS_POR_GRAU * Math.cos((this.lat0 * Math.PI) / 180);

    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.acumulado = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.x[i] = (pontos[i][1] - this.lng0) * this.kx;
      this.y[i] = (pontos[i][0] - this.lat0) * METROS_POR_GRAU;
      if (i > 0) {
        this.acumulado[i] =
          this.acumulado[i - 1] +
          Math.hypot(this.x[i] - this.x[i - 1], this.y[i] - this.y[i - 1]);
      }
    }
    this.comprimento = n > 0 ? this.acumulado[n - 1] : 0;
  }

  /**
   * Projeta um ponto no traçado. Com `dica` (o `s` esperado), entre os trechos
   * quase tão próximos quanto o melhor, fica com o mais perto da dica: o
   * traçado pode passar duas vezes pela mesma rua.
   */
  projetar(pos: LatLng, dica?: number): Projecao {
    const px = (pos.lng - this.lng0) * this.kx;
    const py = (pos.lat - this.lat0) * METROS_POR_GRAU;
    const candidatos: Projecao[] = [];
    let melhor = Infinity;

    for (let i = 0; i < this.x.length - 1; i++) {
      const ax = this.x[i];
      const ay = this.y[i];
      const dx = this.x[i + 1] - ax;
      const dy = this.y[i + 1] - ay;
      const len2 = dx * dx + dy * dy;
      const t =
        len2 > 0
          ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
          : 0;
      const distancia = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (distancia < melhor) melhor = distancia;
      candidatos.push({
        s: this.acumulado[i] + t * Math.sqrt(len2),
        distancia,
      });
    }

    let escolhido: Projecao = { s: 0, distancia: Infinity };
    for (const c of candidatos) {
      if (dica === undefined) {
        if (c.distancia < escolhido.distancia) escolhido = c;
      } else if (
        c.distancia <= melhor + TOLERANCIA_DICA_M &&
        (escolhido.distancia === Infinity ||
          Math.abs(c.s - dica) < Math.abs(escolhido.s - dica))
      ) {
        escolhido = c;
      }
    }
    return escolhido;
  }
}
