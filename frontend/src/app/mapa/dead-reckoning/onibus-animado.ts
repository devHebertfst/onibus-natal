import { Rota, distanciaM } from './rota';

/** Mais longe que isso do traçado, o ônibus é considerado fora da rota. */
const DISTANCIA_MAX_ROTA_M = 60;
/** Abaixo disso, uma "nova" posição é só o mesmo GPS repetido ou ruído. */
const MOVIMENTO_MIN_M = 8;
/** Não extrapola além disso sem nova posição real (ônibus pode ter parado). */
const EXTRAPOLACAO_MAX_S = 40;
/** Constante de tempo da correção suave (s). */
const TAU_CORRECAO_S = 2.5;
/** Diferença acima disso entre exibido e real: em vez de correr, faz transição. */
const SALTO_MAX_M = 400;
/** Duração da transição visual quando o ônibus "pula" (ms). */
const TRANSICAO_MS = 900;
/**
 * Velocidade média de um ônibus urbano contando paradas, semáforos e
 * trânsito. Usada quando a velocidade real ainda é desconhecida e na
 * previsão de chegada.
 */
export const VELOCIDADE_COMERCIAL_KMH = 18;
/** Perto das pontas do traçado (terminais) não estima: o ônibus costuma esperar ali. */
const MARGEM_TERMINAL_M = 250;

export interface Quadro {
  lat: number;
  lng: number;
  /** Rumo em graus (0 = norte) ou null se desconhecido. */
  rumo: number | null;
  /** Código do itinerário em que o ônibus está andando, se inferido. */
  itinerario: string | null;
}

interface Opcao {
  rota: Rota;
  s: number;
  distancia: number;
  /** Quanto andou ao longo desta rota desde a posição anterior (NaN = sem como saber). */
  avanco: number;
}

/**
 * Dead reckoning de um ônibus.
 *
 * Entre duas posições reais (que chegam a cada 20-30s), o ônibus avança ao
 * longo do traçado na velocidade estimada pelo backend:
 *
 *     alvo(t) = sFix + v · (t − tFix)
 *
 * Quando chega uma posição real, em vez de saltar, guardamos a diferença entre
 * onde o ônibus está desenhado e onde deveria estar (`erro`) e a reduzimos
 * exponencialmente a cada quadro — o ônibus acelera ou freia um pouco até
 * "encostar" na trajetória real. Enquanto está em movimento, nunca anda para
 * trás: se estiver adiantado, espera a trajetória real alcançá-lo.
 *
 * O sentido (ida/volta) é inferido comparando duas posições reais
 * consecutivas: vale a rota em que o ônibus avançou (s aumentou).
 */
export class OnibusAnimado {
  velocidadeMs = 0;
  /** false enquanto o backend não souber a velocidade (linha recém-aberta). */
  velocidadeConhecida = true;
  rota: Rota | null = null;

  /** Última posição real (GPS). */
  private fix: [number, number] | null = null;
  private sFix = 0;
  private tFix = 0;
  private erro = 0;
  private sExibido: number | null = null;
  private exibido: [number, number] | null = null;
  private rumoLivre: number | null = null;
  private transicao: { de: [number, number]; inicio: number } | null = null;
  private ultimoQuadro: number | null = null;

  constructor(readonly id: string) {}

  /**
   * Nova leitura vinda do backend.
   * @param velocidadeKmh null = desconhecida: se o sentido já for conhecido,
   *   anda na velocidade comercial até a real chegar (a correção é suave).
   * @param tFix instante (relógio do navegador) em que a posição foi observada.
   * @param candidatas rotas em que o ônibus pode estar (itinerários da linha).
   */
  atualizar(
    pos: [number, number],
    velocidadeKmh: number | null,
    tFix: number,
    candidatas: Rota[],
    agora: number,
  ): void {
    this.velocidadeConhecida = velocidadeKmh !== null;
    this.velocidadeMs = (velocidadeKmh ?? 0) / 3.6;

    const anterior = this.fix;
    if (anterior && distanciaM(anterior, pos) < MOVIMENTO_MIN_M) {
      // GPS ainda não atualizou: segue extrapolando a partir do fix antigo.
      return;
    }
    if (anterior) this.rumoLivre = rumo(anterior, pos);
    this.fix = pos;

    const escolha = this.escolherRota(anterior, pos, candidatas);
    if (!escolha) {
      // Fora do traçado ou sentido ainda desconhecido: mostra a posição real.
      this.iniciarTransicao(agora);
      this.rota = null;
      this.sExibido = null;
      this.erro = 0;
      return;
    }

    const mesmaRota = escolha.rota === this.rota;
    this.rota = escolha.rota;
    this.sFix = escolha.s;
    this.tFix = tFix;
    const alvo = this.alvo(agora);

    if (mesmaRota && this.sExibido !== null && Math.abs(this.sExibido - alvo) < SALTO_MAX_M) {
      this.erro = this.sExibido - alvo; // continua de onde está, corrigindo aos poucos
    } else {
      this.iniciarTransicao(agora);
      this.erro = 0;
      this.sExibido = null;
    }
  }

  /** Onde o ônibus está ao longo do traçado, se a rota (sentido) já foi inferida. */
  posicaoNaRota(): { codigo: string; s: number } | null {
    if (!this.rota) return null;
    return { codigo: this.rota.codigo, s: this.sExibido ?? this.sFix };
  }

  /** O traçado mudou: descarta a rota (será reinferida na próxima posição). */
  esquecerRota(): void {
    this.rota = null;
    this.sExibido = null;
    this.erro = 0;
  }

  /** Posição a desenhar no instante `agora` (chamado a cada quadro). */
  quadro(agora: number): Quadro | null {
    if (!this.fix) return null;
    const dt = this.ultimoQuadro === null ? 0 : Math.max(0, (agora - this.ultimoQuadro) / 1000);
    this.ultimoQuadro = agora;

    let pos: [number, number];
    let rumoAtual = this.rumoLivre;

    if (this.rota) {
      const alvo = this.alvo(agora);
      this.erro *= Math.exp(-dt / TAU_CORRECAO_S);
      let s = alvo + this.erro;
      if (this.sExibido !== null && s < this.sExibido && this.velocidadeEfetiva() > 0.5) {
        // Em movimento não anda de ré: espera o alvo alcançar.
        s = this.sExibido;
        this.erro = s - alvo;
      }
      s = Math.max(0, Math.min(this.rota.comprimento, s));
      this.sExibido = s;
      pos = this.rota.pontoEm(s);
      rumoAtual = this.rota.rumoEm(s);
    } else {
      pos = this.fix;
    }

    if (this.transicao) {
      const k = (agora - this.transicao.inicio) / TRANSICAO_MS;
      if (k >= 1) {
        this.transicao = null;
      } else {
        const e = k * k * (3 - 2 * k); // smoothstep
        const de = this.transicao.de;
        pos = [de[0] + (pos[0] - de[0]) * e, de[1] + (pos[1] - de[1]) * e];
      }
    }

    this.exibido = pos;
    return { lat: pos[0], lng: pos[1], rumo: rumoAtual, itinerario: this.rota?.codigo ?? null };
  }

  private alvo(agora: number): number {
    const rota = this.rota!;
    const dt = Math.max(0, Math.min(EXTRAPOLACAO_MAX_S, (agora - this.tFix) / 1000));
    return Math.min(rota.comprimento, this.sFix + this.velocidadeEfetiva() * dt);
  }

  /** Velocidade usada na extrapolação (m/s): a real ou, se desconhecida, a estimada. */
  private velocidadeEfetiva(): number {
    if (this.velocidadeConhecida) return this.velocidadeMs;
    const rota = this.rota;
    if (!rota || this.sFix < MARGEM_TERMINAL_M || rota.comprimento - this.sFix < MARGEM_TERMINAL_M)
      return 0;
    return VELOCIDADE_COMERCIAL_KMH / 3.6;
  }

  private iniciarTransicao(agora: number): void {
    if (this.exibido) this.transicao = { de: this.exibido, inicio: agora };
  }

  private escolherRota(
    anterior: [number, number] | null,
    pos: [number, number],
    candidatas: Rota[],
  ): Opcao | null {
    const opcoes: Opcao[] = [];

    for (const rota of candidatas) {
      const dica = rota === this.rota ? (this.sExibido ?? this.sFix) : undefined;
      let atual = rota.projetar(pos[0], pos[1], dica);
      if (atual.distancia > DISTANCIA_MAX_ROTA_M) continue;

      let avanco = NaN;
      if (anterior) {
        const ant = rota.projetar(
          anterior[0],
          anterior[1],
          rota === this.rota ? this.sFix : undefined,
        );
        if (ant.distancia <= DISTANCIA_MAX_ROTA_M) {
          // Reprojeta usando a anterior como dica para não pular de trecho.
          atual = rota.projetar(pos[0], pos[1], ant.s);
          avanco = atual.s - ant.s;
        }
      }
      opcoes.push({ rota, s: atual.s, distancia: atual.distancia, avanco });
    }

    // 1) Rotas em que o ônibus andou para a frente. Prefere manter a atual.
    const paraFrente = opcoes.filter((o) => o.avanco > 0);
    if (paraFrente.length > 0) {
      return (
        paraFrente.find((o) => o.rota === this.rota) ??
        paraFrente.reduce((a, b) => (b.distancia < a.distancia ? b : a))
      );
    }
    // 2) Sem como comparar (1ª posição): só decide se não houver ambiguidade.
    const semComparacao = opcoes.filter((o) => Number.isNaN(o.avanco));
    if (semComparacao.length === 1 && opcoes.length === 1) return semComparacao[0];
    // 3) Andou "para trás" em todas, ou ambíguo: não arrisca.
    return null;
  }
}

function rumo(de: [number, number], para: [number, number]): number {
  const kx = Math.cos((de[0] * Math.PI) / 180);
  const graus = (Math.atan2((para[1] - de[1]) * kx, para[0] - de[0]) * 180) / Math.PI;
  return (graus + 360) % 360;
}
