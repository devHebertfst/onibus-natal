import type { CachePersistente } from '../banco/cache-persistente.js';
import type { ItinerarioDto } from './linha.dto.js';
import { PlacarPrevisao, corrigir, dadoEntre, mediana } from './placar.js';

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

  it('aprende a correção do viés e mede a previsão corrigida', () => {
    const placar = new PlacarPrevisao(null);
    expect(placar.ajuste()).toBeNull();
    for (let i = 0; i < 30; i++)
      percorrer(placar, undefined, { id: `X${i}`, t0: T0 + i * 3_600_000 });
    // viés de ~−2 min a 2 min da chegada, limitado a 25% do horizonte
    const ajuste = placar.ajuste()!;
    expect(ajuste.minutos).toContain(2);
    expect(ajuste.correcaoMin[ajuste.minutos.indexOf(2)]).toBe(-0.5);
    const r = placar.resumo();
    expect(r.ajuste).toEqual(ajuste);
    // depois da correção, a ajustada erra menos que a crua
    expect(r.ajustada['2'].erroMedioMin).toBeLessThan(
      r.nossa['2'].erroMedioMin,
    );
    expect(r.ajustada['2'].viesMin).toBeGreaterThan(r.nossa['2'].viesMin);
  });

  it('lê o placar gravado antes da correção', async () => {
    const antigo = {
      desde: T0,
      em: T0,
      fontes: { nossa: {}, nubus: {} },
      pares: {},
    };
    const placar = new PlacarPrevisao({
      ler: async () => antigo,
    } as unknown as CachePersistente);
    await placar.onModuleInit();
    percorrer(placar);
    const r = placar.resumo();
    expect(r.nossa['2'].n).toBeGreaterThanOrEqual(2);
    expect(r.ajustada['2'].n).toBeGreaterThanOrEqual(2);
    expect(r.porLinha).toHaveLength(1);
  });
});

describe('correção pelo viés mediano', () => {
  /** Placar gravado com os histogramas dados. */
  const comHistogramas = async (
    hist2: number[],
    linhas: Record<string, number[]>,
  ) => {
    const soma = (h: number[]) => h.reduce((a, b) => a + b, 0);
    const salvo = {
      desde: T0,
      em: Date.now(),
      fontes: {
        nossa: { '2': { n: soma(hist2), somaAbs: 0, soma: 0, hist: hist2 } },
        ajustada: {},
        nubus: {},
      },
      pares: {},
      porDado: {},
      porLinha: Object.fromEntries(
        Object.entries(linhas).map(([l, hist]) => [
          l,
          { n: soma(hist), somaAbs: 0, soma: 0, hist },
        ]),
      ),
    };
    const placar = new PlacarPrevisao({
      ler: async () => salvo,
    } as unknown as CachePersistente);
    await placar.onModuleInit();
    return placar;
  };
  /** 81 caixas, com `n` na caixa `desvio` caixas longe do zero. */
  const hist = (...pontos: [desvio: number, n: number][]) => {
    const h = Array.from({ length: 81 }, () => 0);
    for (const [d, n] of pontos) h[40 + d] += n;
    return h;
  };

  it('não corrige quando só alguns poucos atrasam muito', async () => {
    // 40 chegadas certas e 10 com 10 min de atraso: a média puxa, a mediana não
    const placar = await comHistogramas(hist([0, 40], [-20, 10]), {});
    const ajuste = placar.ajuste()!;
    expect(ajuste.minutos).toEqual([2]);
    expect(Math.abs(ajuste.correcaoMin[0])).toBeLessThan(0.1);
    // a média diria −2 min
    expect(placar.resumo().nossa['2'].viesMedianoMin).toBeCloseTo(-0.1, 1);
  });

  it('a linha com chegadas suficientes tem correção própria, limitada', async () => {
    const placar = await comHistogramas(hist([-1, 40]), {
      lenta: hist([-10, 60]), // chega 50% depois do previsto
      muitoLenta: hist([-36, 60]), // 180% depois: limitada a dobrar
      pouca: hist([-10, 20]), // poucas chegadas: usa a geral
    });
    expect(placar.ajuste('lenta')!.fracaoLinha).toBeCloseTo(-0.5);
    expect(placar.ajuste('muitoLenta')!.fracaoLinha).toBe(-1);
    expect(placar.ajuste('pouca')!.fracaoLinha).toBeUndefined();
    expect(placar.ajuste('pouca')!.correcaoMin[0]).toBeCloseTo(-0.5);
    expect(placar.resumo().porLinha).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          linha: 'lenta',
          viesMedianoPct: -50,
          correcaoPct: -50,
        }),
        expect.objectContaining({ linha: 'pouca', correcaoPct: null }),
      ]),
    );
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

describe('corrigir', () => {
  const ajuste = { minutos: [2, 5], correcaoMin: [-0.4, -0.6] };
  it('interpola entre os horizontes e segura o último', () => {
    expect(corrigir(1, ajuste)).toBeCloseTo(-0.2);
    expect(corrigir(3.5, ajuste)).toBeCloseTo(-0.5);
    expect(corrigir(20, ajuste)).toBeCloseTo(-0.6);
    expect(corrigir(0, ajuste)).toBe(0);
    expect(corrigir(5, null)).toBe(0);
    // a linha com correção própria: fração da previsão, no lugar da curva
    expect(corrigir(10, { ...ajuste, fracaoLinha: -0.5 })).toBeCloseTo(-5);
  });
});

describe('dadoEntre', () => {
  const trechos = { tamanhoM: 300, kmh: [], mediaKmh: 20, fontes: 'vhhh--' };
  it('diz de onde veio a maior parte da velocidade', () => {
    expect(dadoEntre(trechos, 0, 1800)).toBe('historico');
    expect(dadoEntre(trechos, 0, 300)).toBe('aoVivo');
    expect(dadoEntre(trechos, 1200, 1800)).toBe('mediaLinha');
    expect(dadoEntre({ ...trechos, mediaKmh: null }, 1200, 1800)).toBe(
      'padrao',
    );
    expect(dadoEntre(undefined, 0, 600)).toBe('padrao');
  });
});
