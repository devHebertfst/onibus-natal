import type { CachePersistente } from '../banco/cache-persistente.js';
import type { ItinerarioDto } from './linha.dto.js';
import { PlacarPrevisao, dadoEntre, mediana } from './placar.js';

const M = 1 / 111_195;
/** Avenida reta de 2 km rumo ao norte, paradas a 600, 1200 e 1800 m. */
const em = (metros: number) => ({ lat: -5.8 + metros * M, lng: -35.2 });
const ida: ItinerarioDto = {
  codigo: 'ida',
  descricao: '',
  tracado: Array.from({ length: 21 }, (_, i) => [-5.8 + i * 100 * M, -35.2]),
  paradas: [600, 1200, 1800].map((m, i) => ({
    codigo: `P${m}`,
    descricao: '',
    ordem: i,
    ...em(m),
  })),
  // a previsão acha que o ônibus anda a 36 km/h (10 m/s)...
  trechos: { tamanhoM: 300, kmh: Array(7).fill(36), mediaKmh: 36 },
};
const T0 = Date.parse('2026-10-13T10:00:00Z');

/** ...mas ele anda a 5 m/s. Uma posição a cada 15 s. */
function percorrer(
  placar: PlacarPrevisao,
  aCada?: (segundos: number) => void,
  { id = 'X', t0 = T0, itinerario = ida } = {},
) {
  for (let s = 0; s <= 420; s += 15) {
    const t = t0 + s * 1000;
    placar.observarLinha(
      '33',
      [itinerario],
      [{ id, itinerarios: ['ida'], ...em(Math.min(2000, 5 * s)), t }],
      t,
    );
    aCada?.(s);
  }
}

describe('PlacarPrevisao', () => {
  it('compara a previsão com a chegada real, por antecedência', () => {
    const placar = new PlacarPrevisao(null);
    percorrer(placar);
    const r = placar.resumo();
    // a 2 min da parada a previsão dizia "2 min"; o ônibus levou ~4
    expect(r.nossa['2'].n).toBeGreaterThanOrEqual(2);
    expect(r.nossa['2'].viesMin).toBeLessThan(-1.5); // chegou depois do previsto
    expect(r.nossa['2'].erroMedioMin).toBeGreaterThan(1.5);
    expect(r.nossa['2'].p90Min).toBeGreaterThanOrEqual(r.nossa['2'].medianaMin);
  });

  it('mede a Nubus na mesma chegada e diz quem errou menos', () => {
    const placar = new PlacarPrevisao(null);
    percorrer(placar, (s) => {
      // aos 240 s a Nubus diz que o ônibus chega aos 1800 m em 2 min: certo
      if (s === 240)
        placar.registrarNubus(
          'ida',
          'P1800',
          [{ onibus: 'X', aoVivo: true, chegaEm: T0 + 360_000 }],
          T0 + 240_000,
        );
    });
    const r = placar.resumo();
    expect(r.nubus['2']).toMatchObject({ n: 1, erroMedioMin: 0, viesMin: 0 });
    expect(r.comparacao['2']).toEqual({ n: 1, nossaMelhorPct: 0 });
  });

  it('não prevê antes de saber o sentido nem conta ônibus fora da rota', () => {
    const placar = new PlacarPrevisao(null);
    // parado, sem se mover: sentido desconhecido
    for (let s = 0; s <= 300; s += 15) {
      const t = T0 + s * 1000;
      placar.observarLinha(
        '33',
        [ida],
        [{ id: 'P', itinerarios: ['ida'], ...em(0), t }],
        t,
      );
    }
    // longe do traçado
    for (let s = 0; s <= 300; s += 15) {
      const t = T0 + s * 1000;
      const longe = { lat: -5.8 + 5 * s * M, lng: -35.21 };
      placar.observarLinha(
        '33',
        [ida],
        [{ id: 'L', itinerarios: ['ida'], ...longe, t }],
        t,
      );
    }
    expect(placar.resumo().nossa).toEqual({});
  });

  it('separa o erro pela origem da velocidade e por linha', () => {
    const placar = new PlacarPrevisao(null);
    percorrer(placar); // trechos sem origem: média da linha
    percorrer(placar, undefined, {
      id: 'Y',
      t0: T0 + 3_600_000,
      itinerario: {
        ...ida,
        trechos: { ...ida.trechos!, fontes: 'vvvvvvv' },
      },
    });
    const r = placar.resumo();
    expect(r.porDado.mediaLinha?.['2'].n).toBeGreaterThanOrEqual(2);
    expect(r.porDado.aoVivo?.['2'].n).toBeGreaterThanOrEqual(2);
    expect(r.porDado.historico).toBeUndefined();
    expect(r.porLinha).toEqual([
      expect.objectContaining({ linha: '33', viesPct: expect.any(Number) }),
    ]);
    // chegou bem depois do previsto: viés negativo, em % da antecedência
    expect(r.porLinha[0].viesPct).toBeLessThan(-30);
  });

  it('lê o placar gravado antes das divisões ou com a correção (que saiu)', async () => {
    const antigo = {
      desde: T0,
      em: T0,
      fontes: { nossa: {}, ajustada: {}, nubus: {} },
      pares: {},
    };
    const placar = new PlacarPrevisao({
      ler: async () => antigo,
    } as unknown as CachePersistente);
    await placar.onModuleInit();
    percorrer(placar);
    const r = placar.resumo();
    expect(r.nossa['2'].n).toBeGreaterThanOrEqual(2);
    expect(r).not.toHaveProperty('ajustada');
    expect(r.porLinha).toHaveLength(1);
  });
});

describe('viés mediano', () => {
  /** 81 caixas, com `n` na caixa `desvio` caixas longe do zero. */
  const hist = (...pontos: [desvio: number, n: number][]) => {
    const h = Array.from({ length: 81 }, () => 0);
    for (const [d, n] of pontos) h[40 + d] += n;
    return h;
  };

  it('mostra o viés da maioria, que a média esconde', async () => {
    // 40 chegadas certas e 10 com 10 min de atraso: a média puxa, a mediana não
    const h2 = hist([0, 40], [-20, 10]);
    const lenta = hist([-10, 60]); // chega 50% depois do previsto
    const salvo = {
      desde: T0,
      em: Date.now(),
      fontes: {
        nossa: { '2': { n: 50, somaAbs: 6e6, soma: -6e6, hist: h2 } },
        nubus: {},
      },
      pares: {},
      porDado: {},
      porLinha: { lenta: { n: 60, somaAbs: 30, soma: -30, hist: lenta } },
    };
    const placar = new PlacarPrevisao({
      ler: async () => salvo,
    } as unknown as CachePersistente);
    await placar.onModuleInit();
    const r = placar.resumo();
    expect(r.nossa['2'].viesMin).toBe(-2);
    expect(r.nossa['2'].viesMedianoMin).toBeCloseTo(-0.1, 1);
    expect(r.porLinha).toEqual([
      { linha: 'lenta', n: 60, erroPct: 50, viesPct: -50, viesMedianoPct: -50 },
    ]);
  });
});

describe('mediana', () => {
  it('interpola dentro da caixa', () => {
    expect(mediana([0, 0, 2, 0, 0], 1)).toBeCloseTo(0);
    expect(mediana([0, 0, 0, 0, 3], 10)).toBeCloseTo(20);
    expect(mediana([1, 0, 0, 0, 3], 1)).toBeCloseTo(1.5 + 1 / 3, 5);
    expect(mediana([0, 0, 0], 1)).toBe(0);
  });
});

describe('dadoEntre', () => {
  const trechos = { tamanhoM: 300, kmh: [], mediaKmh: 20, fontes: 'vhhh--aa' };
  it('diz de onde veio a maior parte da velocidade', () => {
    expect(dadoEntre(trechos, 0, 1800)).toBe('historico');
    expect(dadoEntre(trechos, 1800, 2400)).toBe('historicoAmplo');
    expect(dadoEntre(trechos, 0, 300)).toBe('aoVivo');
    expect(dadoEntre(trechos, 1200, 1800)).toBe('mediaLinha');
    expect(dadoEntre({ ...trechos, mediaKmh: null }, 1200, 1800)).toBe(
      'padrao',
    );
    expect(dadoEntre(undefined, 0, 600)).toBe('padrao');
  });
});
