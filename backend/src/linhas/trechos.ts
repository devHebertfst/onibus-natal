import { config } from '../config.js';
import type { LatLng } from './geo.js';
import type { TrechosDto } from './linha.dto.js';
import { type Celula, celulasEntre } from './celulas.js';
import { RotaMetros } from './rota.js';

export type ParametrosTrechos = typeof config.trechos;

/** Metros percorridos e segundos gastos num trecho (somados, com peso). */
export interface PercursoTipico {
  metros: number;
  segundos: number;
  /**
   * Veio de horários mais longe do atual (até ±2 h, ou o dia todo), porque
   * o horário atual não tinha medida bastante nesse trecho.
   */
  amplo?: boolean;
}

/**
 * Trânsito compartilhado entre linhas (ver `TransitoCidade`): quanto mais
 * lento que o normal os ônibus estão em cada pedaço de rua.
 */
export interface FonteTransito {
  registrar(
    celulas: Celula[],
    linha: string,
    razao: number,
    metros: number,
    t: number,
  ): void;
  fator(
    celulas: Celula[],
    linhaExcluida: string,
    agora: number,
  ): number | undefined;
}

/**
 * Memória de longo prazo (ver `HistoricoTrechos`): recebe cada percurso
 * medido e devolve o típico de cada trecho para o horário.
 */
export interface FonteHistorico {
  registrar(
    itinerario: string,
    assinatura: string,
    trecho: number,
    metros: number,
    segundos: number,
    t: number,
  ): void;
  /** Começa a ler o histórico do itinerário e resolve quando ele chega. */
  preparar(
    itinerario: string,
    assinatura: string,
    agora: number,
  ): Promise<void>;
  /** trecho → percurso típico neste horário; `undefined` se ainda não há. */
  tipico(
    itinerario: string,
    assinatura: string,
    agora: number,
  ): Map<number, PercursoTipico> | undefined;
}

/** Onde e quando um ônibus foi visto por último num itinerário. */
interface Passagem {
  s: number;
  t: number;
}

interface Itinerario {
  assinatura: string;
  rota: RotaMetros;
  /** Por trecho: metros percorridos e segundos gastos, com decaimento. */
  metros: Float64Array;
  segundos: Float64Array;
  /** Instante a que `metros` e `segundos` de cada trecho se referem. */
  em: Float64Array;
  ultimas: Map<string, Passagem>;
  /** Pedaços de rua por onde cada trecho passa (só com trânsito compartilhado). */
  celulas: Celula[][];
}

/**
 * Velocidade de cada trecho do traçado (300 m), medida pelos próprios ônibus
 * da linha: são sensores de trânsito que passam pelo mesmo caminho minutos
 * antes. Cada par de posições consecutivas de um ônibus vira uma observação
 * "andou de s0 a s1 em Δt segundos"; o tempo é repartido entre os trechos
 * cobertos, na proporção do quanto de cada um foi percorrido.
 *
 * Como o tempo inclui o que o ônibus ficou parado entre as duas posições, a
 * velocidade de um trecho já conta paradas, semáforos e engarrafamento: é a
 * velocidade comercial daquele pedaço, agora.
 *
 * A velocidade é metros ÷ segundos somados (e não a média das velocidades):
 * é o que faz a soma dos tempos por trecho bater com o tempo de viagem. As
 * observações perdem peso com o tempo (meia-vida), para acompanhar o trânsito.
 *
 * Ônibus no sentido contrário, projetados neste traçado, "andam para trás"
 * (s diminui) e são ignorados.
 *
 * Com um `historico`, cada percurso também vai para ele, e os trechos sem
 * medida recente usam a velocidade típica daquele dia e horário. Com o
 * `transito` da cidade, a linha conta às outras quanto está mais lenta (ou
 * rápida) que o normal em cada rua, e ajusta o típico dos trechos dela pelo
 * que as outras mediram nas ruas em comum.
 */
export class VelocidadeTrechos {
  private readonly itinerarios = new Map<string, Itinerario>();
  /** Percursos medidos desde que a linha começou a ser acompanhada. */
  private medidas = 0;

  constructor(
    private readonly p: ParametrosTrechos = config.trechos,
    private readonly historico?: FonteHistorico,
    private readonly transito?: { cidade: FonteTransito; linha: string },
  ) {}

  /**
   * Traçados atuais da linha. Um itinerário novo ou com traçado diferente
   * começa do zero; os que sumiram são esquecidos.
   */
  definirTracados(lista: { codigo: string; tracado: [number, number][] }[]) {
    const codigos = new Set<string>();
    for (const { codigo, tracado } of lista) {
      if (tracado.length < 2) continue;
      codigos.add(codigo);
      const assinatura = `${tracado.length}:${tracado[0]}:${tracado.at(-1)}`;
      if (this.itinerarios.get(codigo)?.assinatura === assinatura) continue;

      const rota = new RotaMetros(tracado);
      const n = Math.max(1, Math.ceil(rota.comprimento / this.p.tamanhoM));
      this.itinerarios.set(codigo, {
        assinatura,
        rota,
        metros: new Float64Array(n),
        segundos: new Float64Array(n),
        em: new Float64Array(n),
        ultimas: new Map(),
        celulas: this.transito
          ? Array.from({ length: n }, (_, k) =>
              celulasEntre(
                rota,
                k * this.p.tamanhoM,
                Math.min(rota.comprimento, (k + 1) * this.p.tamanhoM),
              ),
            )
          : [],
      });
    }
    for (const codigo of this.itinerarios.keys()) {
      if (!codigos.has(codigo)) this.itinerarios.delete(codigo);
    }
  }

  /**
   * Espera (até `limiteMs`) o histórico dos itinerários chegar do banco: na
   * 1ª atualização de uma linha, evita mandar a resposta sem ele.
   */
  async prepararHistorico(agora: number, limiteMs: number): Promise<void> {
    const historico = this.historico;
    if (!historico) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(
        [...this.itinerarios].map(([codigo, it]) =>
          historico.preparar(codigo, it.assinatura, agora),
        ),
      ),
      new Promise<void>((r) => (timer = setTimeout(r, limiteMs))),
    ]);
    clearTimeout(timer);
  }

  /**
   * Posição do ônibus no itinerário, medida pelo GPS no instante `t`. Chamar
   * de novo com o mesmo `t` (GPS ainda não atualizou) não muda nada.
   */
  observar(codigo: string, id: string, pos: LatLng, t: number): void {
    const it = this.itinerarios.get(codigo);
    if (!it) return;
    const anterior = it.ultimas.get(id);
    if (anterior && t <= anterior.t) return;

    const proj = it.rota.projetar(pos, anterior?.s);
    if (proj.distancia > this.p.distanciaMaxRotaM) {
      it.ultimas.delete(id);
      return;
    }
    it.ultimas.set(id, { s: proj.s, t });
    if (!anterior) return;

    const ds = proj.s - anterior.s;
    const dt = (t - anterior.t) / 1000;
    if (
      ds <= 0 ||
      ds > this.p.avancoMaxM ||
      dt * 1000 > this.p.intervaloMaxMs ||
      (ds / dt) * 3.6 > this.p.velocidadeMaxKmh
    ) {
      return;
    }
    // O típico do horário, para dizer às outras linhas o quanto está fora dele.
    const tipico = this.transito
      ? this.historico?.tipico(codigo, it.assinatura, t)
      : undefined;
    this.repartir(codigo, it, anterior.s, proj.s, dt, t, tipico);
    this.medidas++;
  }

  /** Quantos percursos (pares de posições) já viraram velocidade. */
  get totalMedidas(): number {
    return this.medidas;
  }

  /** Velocidades atuais do itinerário, ou `undefined` se ele não é conhecido. */
  velocidades(codigo: string, agora: number): TrechosDto | undefined {
    const it = this.itinerarios.get(codigo);
    if (!it) return undefined;

    const vivo: (number | null)[] = [];
    let metros = 0;
    let segundos = 0;
    for (let k = 0; k < it.metros.length; k++) {
      const idade = agora - it.em[k];
      if (it.segundos[k] === 0 || idade > this.p.janelaMs) {
        vivo.push(null);
        continue;
      }
      const peso = this.peso(idade);
      metros += it.metros[k] * peso;
      segundos += it.segundos[k] * peso;
      const cobertura = (it.metros[k] * peso) / this.tamanhoDo(it, k);
      vivo.push(
        cobertura >= this.p.coberturaMin
          ? umaCasa((it.metros[k] / it.segundos[k]) * 3.6)
          : null,
      );
    }
    const minimoM = this.p.tamanhoM * this.p.coberturaMin;

    // O típico deste dia e horário, trecho a trecho (do histórico); onde o
    // horário não tem medida, o do mesmo trecho noutro horário (`amplo`).
    const tipicoKmh: (number | null)[] = vivo.map(() => null);
    const amplo: boolean[] = vivo.map(() => false);
    let metrosTipicos = 0;
    let segundosTipicos = 0;
    for (const [k, v] of this.historico?.tipico(codigo, it.assinatura, agora) ??
      []) {
      if (k >= vivo.length || v.segundos <= 0) continue;
      if (!v.amplo) {
        metrosTipicos += v.metros;
        segundosTipicos += v.segundos;
      }
      if (v.metros / this.tamanhoDo(it, k) >= this.p.coberturaMin) {
        tipicoKmh[k] = (v.metros / v.segundos) * 3.6;
        amplo[k] = !!v.amplo;
      }
    }
    const mediaTipica = media(metrosTipicos, segundosTipicos, minimoM);

    // Onde nenhum ônibus da linha passou há pouco: o típico, ajustado pelo
    // trânsito que as outras linhas estão vendo nas mesmas ruas.
    let fontes = '';
    const kmh = vivo.map((v, k) => {
      if (v !== null) {
        fontes += 'v';
        return v;
      }
      const fator = this.transito?.cidade.fator(
        it.celulas[k],
        this.transito.linha,
        agora,
      );
      const base = tipicoKmh[k] ?? (fator !== undefined ? mediaTipica : null);
      fontes +=
        tipicoKmh[k] !== null
          ? amplo[k]
            ? 'a'
            : 'h'
          : base !== null
            ? 't'
            : '-';
      return base === null ? null : umaCasa(base * (fator ?? 1));
    });

    return {
      tamanhoM: this.p.tamanhoM,
      kmh,
      mediaKmh: media(metros, segundos, minimoM) ?? mediaTipica,
      fontes,
    };
  }

  /** Esquece a última posição de ônibus que sumiram do itinerário. */
  esquecerAntigos(agora: number): void {
    for (const it of this.itinerarios.values()) {
      for (const [id, u] of it.ultimas) {
        if (agora - u.t > this.p.intervaloMaxMs) it.ultimas.delete(id);
      }
    }
  }

  /** Divide o percurso [s0, s1] feito em `dt` segundos entre os trechos. */
  private repartir(
    codigo: string,
    it: Itinerario,
    s0: number,
    s1: number,
    dt: number,
    t: number,
    tipico?: Map<number, PercursoTipico>,
  ) {
    const tam = this.p.tamanhoM;
    const ultimo = it.metros.length - 1;
    for (let k = Math.floor(s0 / tam); k <= Math.min(ultimo, s1 / tam); k++) {
      const coberto = Math.min(s1, (k + 1) * tam) - Math.max(s0, k * tam);
      if (coberto <= 0) continue;
      const gasto = (dt * coberto) / (s1 - s0);
      const peso = this.peso(Math.max(0, t - it.em[k]));
      it.metros[k] = it.metros[k] * peso + coberto;
      it.segundos[k] = it.segundos[k] * peso + gasto;
      it.em[k] = Math.max(it.em[k], t);
      this.historico?.registrar(codigo, it.assinatura, k, coberto, gasto, t);

      const normal = tipico?.get(k);
      if (
        this.transito &&
        normal &&
        normal.segundos > 0 &&
        // Típico de outro horário não diz se agora está lento ou não.
        !normal.amplo &&
        normal.metros / this.tamanhoDo(it, k) >= this.p.coberturaMin
      ) {
        const razao = coberto / gasto / (normal.metros / normal.segundos);
        this.transito.cidade.registrar(
          it.celulas[k],
          this.transito.linha,
          razao,
          coberto,
          t,
        );
      }
    }
  }

  private peso(idadeMs: number): number {
    return Math.pow(0.5, idadeMs / this.p.meiaVidaMs);
  }

  /** O último trecho costuma ser mais curto que os outros. */
  private tamanhoDo(it: Itinerario, k: number): number {
    const fim = Math.min(it.rota.comprimento, (k + 1) * this.p.tamanhoM);
    return Math.max(1, fim - k * this.p.tamanhoM);
  }
}

const umaCasa = (v: number) => Math.round(v * 10) / 10;

/** Velocidade média (km/h) se houver percurso suficiente para valer. */
function media(metros: number, segundos: number, minimoM: number) {
  return segundos > 0 && metros >= minimoM
    ? umaCasa((metros / segundos) * 3.6)
    : null;
}
