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

/**
 * Desaceleração perto das paradas, no desenho: o ônibus reduz nos metros
 * antes da parada até uma fração da velocidade de cruzeiro e retoma depois.
 */
const FREIA_ANTES_M = 60;
const RETOMA_DEPOIS_M = 30;
const FRACAO_NA_PARADA = 0.3;
/** Resolução do perfil (m). */
const PASSO_PERFIL_M = 5;

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

  /**
   * Paradas no traçado, para a desaceleração do desenho. Projeta em ordem,
   * com a anterior como dica (o traçado pode repetir ruas).
   */
  definirParadas(paradas: { lat: number; lng: number; ordem: number }[]): void {
    const posicoes: number[] = [];
    let dica: number | undefined;
    for (const p of [...paradas].sort((a, b) => a.ordem - b.ordem)) {
      dica = this.projetar(p.lat, p.lng, dica).s;
      posicoes.push(dica);
    }
    posicoes.sort((a, b) => a - b);

    // Fator de velocidade a cada 5 m (1 = cruzeiro) e o "custo" acumulado
    // ∫ 1/fator: andar pelo perfil é andar por esse custo a passo constante.
    const n = Math.ceil(this.comprimento / PASSO_PERFIL_M) + 1;
    const custo = new Float64Array(n);
    let j = 0;
    for (let k = 1; k < n; k++) {
      const s = (k - 0.5) * PASSO_PERFIL_M;
      while (j < posicoes.length - 1 && posicoes[j + 1] <= s) j++;
      let fator = 1;
      for (const p of [posicoes[j], posicoes[j + 1]]) {
        if (p === undefined) continue;
        const d = s - p; // < 0: chegando; > 0: saindo
        const t = d < 0 ? -d / FREIA_ANTES_M : d / RETOMA_DEPOIS_M; // 0 na parada, 1 longe
        if (t < 1) fator = Math.min(fator, FRACAO_NA_PARADA + (1 - FRACAO_NA_PARADA) * t);
      }
      custo[k] = custo[k - 1] + PASSO_PERFIL_M / fator;
    }
    this.custo = posicoes.length > 0 ? custo : null;
  }

  /**
   * Onde o ônibus está depois de andar `metros` a partir de `s0`, freando
   * nas paradas. A velocidade de cruzeiro é ajustada para que, ao fim de
   * `janela` metros, o tempo gasto seja o mesmo da velocidade constante: a
   * média não muda, só o formato do movimento.
   */
  avancar(s0: number, metros: number, janela: number): number {
    const custo = this.custo;
    if (!custo || metros <= 0 || janela <= 0) return s0 + metros;
    const c0 = this.custoEm(s0);
    const fim = Math.min(this.comprimento, s0 + janela);
    if (fim <= s0) return s0 + metros;
    const escala = (this.custoEm(fim) - c0) / (fim - s0);
    return this.sDoCusto(c0 + metros * escala);
  }

  private custo: Float64Array | null = null;

  private custoEm(s: number): number {
    const custo = this.custo!;
    const x = Math.max(0, Math.min(this.comprimento, s)) / PASSO_PERFIL_M;
    const i = Math.min(custo.length - 2, Math.floor(x));
    return custo[i] + (custo[i + 1] - custo[i]) * (x - i);
  }

  private sDoCusto(c: number): number {
    const custo = this.custo!;
    if (c >= custo[custo.length - 1]) return this.comprimento;
    let lo = 0;
    let hi = custo.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (custo[mid] <= c) lo = mid;
      else hi = mid;
    }
    const t = (c - custo[lo]) / (custo[hi] - custo[lo] || 1);
    return Math.min(this.comprimento, (lo + t) * PASSO_PERFIL_M);
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
