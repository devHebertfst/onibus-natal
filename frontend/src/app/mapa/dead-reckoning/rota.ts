/**
 * Traçado de um itinerário pronto para dead reckoning: converte lat/lng para
 * metros num plano local (projeção equiretangular, precisa o bastante na
 * escala de uma cidade) e pré-calcula a distância acumulada de cada vértice.
 *
 * Com isso, a posição de um ônibus vira um único número: `s`, a distância em
 * metros desde o início do traçado. Andar com o ônibus é só somar a `s`.
 */
import { PerfilVelocidade } from './perfil-velocidade';

const METROS_POR_GRAU = 111_195;

export interface Projecao {
  /** Distância ao longo do traçado (m). */
  s: number;
  /** Distância do ponto até o traçado (m). */
  distancia: number;
}

export class Rota {
  readonly comprimento: number;
  /** Velocidade medida pelos ônibus em cada trecho; renovada a cada atualização. */
  perfil = new PerfilVelocidade();
  private readonly x: Float64Array;
  private readonly y: Float64Array;
  /** Distância acumulada até cada vértice. */
  private readonly acumulado: Float64Array;
  private readonly lat0: number;
  private readonly lng0: number;
  private readonly kx: number;

  constructor(
    readonly codigo: string,
    pontos: [number, number][],
  ) {
    if (pontos.length < 2) throw new Error(`Rota ${codigo}: traçado com menos de 2 pontos`);
    const n = pontos.length;
    this.lat0 = pontos.reduce((a, p) => a + p[0], 0) / n;
    this.lng0 = pontos.reduce((a, p) => a + p[1], 0) / n;
    this.kx = METROS_POR_GRAU * Math.cos((this.lat0 * Math.PI) / 180);

    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.acumulado = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      [this.x[i], this.y[i]] = this.paraXY(pontos[i][0], pontos[i][1]);
      if (i > 0) {
        this.acumulado[i] =
          this.acumulado[i - 1] + Math.hypot(this.x[i] - this.x[i - 1], this.y[i] - this.y[i - 1]);
      }
    }
    this.comprimento = this.acumulado[n - 1];
  }

  /**
   * Projeta um ponto no traçado. Traçados podem passar duas vezes pelo mesmo
   * lugar (ida e volta na mesma rua, laços); com `dica` (o `s` esperado), entre
   * os trechos quase tão próximos quanto o melhor, escolhe o mais coerente com
   * onde o ônibus deveria estar.
   */
  projetar(lat: number, lng: number, dica?: number): Projecao {
    const [px, py] = this.paraXY(lat, lng);
    const candidatos: Projecao[] = [];
    let melhor = Infinity;

    for (let i = 0; i < this.x.length - 1; i++) {
      const ax = this.x[i];
      const ay = this.y[i];
      const dx = this.x[i + 1] - ax;
      const dy = this.y[i + 1] - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const distancia = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (distancia < melhor) melhor = distancia;
      candidatos.push({ s: this.acumulado[i] + t * Math.sqrt(len2), distancia });
    }

    const tolerancia = dica === undefined ? 0 : 25;
    let escolhido: Projecao | undefined;
    for (const c of candidatos) {
      if (c.distancia > melhor + tolerancia) continue;
      if (
        !escolhido ||
        (dica === undefined
          ? c.distancia < escolhido.distancia
          : Math.abs(c.s - dica) < Math.abs(escolhido.s - dica))
      ) {
        escolhido = c;
      }
    }
    return escolhido!;
  }

  /** Ponto [lat, lng] a `s` metros do início do traçado. */
  pontoEm(s: number): [number, number] {
    const i = this.segmentoEm(s);
    const ini = this.acumulado[i];
    const len = this.acumulado[i + 1] - ini;
    const t = len > 0 ? (s - ini) / len : 0;
    return this.paraLatLng(
      this.x[i] + t * (this.x[i + 1] - this.x[i]),
      this.y[i] + t * (this.y[i + 1] - this.y[i]),
    );
  }

  /** Rumo em graus (0 = norte, sentido horário) no ponto `s`. */
  rumoEm(s: number): number {
    const i = this.segmentoEm(s);
    const graus =
      (Math.atan2(this.x[i + 1] - this.x[i], this.y[i + 1] - this.y[i]) * 180) / Math.PI;
    return (graus + 360) % 360;
  }

  /** Índice do segmento que contém `s` (busca binária). */
  private segmentoEm(s: number): number {
    const v = Math.max(0, Math.min(this.comprimento, s));
    let lo = 0;
    let hi = this.acumulado.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.acumulado[mid] <= v) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private paraXY(lat: number, lng: number): [number, number] {
    return [(lng - this.lng0) * this.kx, (lat - this.lat0) * METROS_POR_GRAU];
  }

  private paraLatLng(x: number, y: number): [number, number] {
    return [this.lat0 + y / METROS_POR_GRAU, this.lng0 + x / this.kx];
  }
}

/** Distância aproximada em metros entre dois pontos próximos. */
export function distanciaM(a: [number, number], b: [number, number]): number {
  const kx = METROS_POR_GRAU * Math.cos((a[0] * Math.PI) / 180);
  return Math.hypot((b[1] - a[1]) * kx, (b[0] - a[0]) * METROS_POR_GRAU);
}
