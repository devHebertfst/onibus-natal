import { config } from '../config.js';
import { celulasEntre, quadrasDoTracado } from './celulas.js';
import { RotaMetros } from './rota.js';
import { type FonteHistorico, VelocidadeTrechos } from './trechos.js';
import { TransitoCidade } from './transito.js';

/** Avenida reta de 2 km rumo ao norte, com um ponto a cada 100 m. */
const M = 1 / 111_195;
const reta: [number, number][] = Array.from({ length: 21 }, (_, i) => [
  -5.8 + i * 100 * M,
  -35.2,
]);
const em = (metros: number) => ({ lat: -5.8 + metros * M, lng: -35.2 });
const MIN = 60_000;

/** Histórico em que todo trecho, neste horário, costuma andar a `kmh`. */
const historicoFixo = (kmh: number): FonteHistorico => ({
  registrar: () => {},
  preparar: async () => {},
  tipico: () =>
    new Map(
      Array.from({ length: 7 }, (_, k) => [
        k,
        { metros: 300, segundos: 300 / (kmh / 3.6) },
      ]),
    ),
});

describe('celulas', () => {
  it('cada trecho cai nos pedaços de rua por onde passa, com o sentido', () => {
    const ida = new RotaMetros(reta);
    const volta = new RotaMetros([...reta].reverse());
    const c = celulasEntre(ida, 0, 300);
    expect(c.length).toBeGreaterThanOrEqual(2);
    expect(c.every((x) => x.endsWith(':0'))).toBe(true); // rumo norte
    const v = celulasEntre(volta, 1700, 2000); // mesma rua, rumo sul
    expect(v.every((x) => x.endsWith(':4'))).toBe(true);
    // a grade sem rumo do traçado inteiro contém a de cada trecho
    const quadras = quadrasDoTracado(reta.map(([lat, lng]) => ({ lat, lng })));
    for (const x of celulasEntre(ida, 0, 2000))
      expect(quadras.has(x.replace(/:\d$/, ''))).toBe(true);
  });
});

describe('TransitoCidade', () => {
  const ida = new RotaMetros(reta);
  const celulas = celulasEntre(ida, 0, 300);

  it('dá às outras linhas o quanto a rua está mais lenta que o normal', () => {
    const t = new TransitoCidade();
    t.registrar(celulas, '85', 0.5, 300, 0);
    expect(t.fator(celulas, '33', 0)).toBeCloseTo(0.5, 6);
    // a própria linha não se usa: o que ela mede já está nos trechos dela
    expect(t.fator(celulas, '85', 0)).toBeUndefined();
    // e o sentido contrário da rua não tem nada a ver
    const sul = celulas.map((c) => c.replace(/:0$/, ':4'));
    expect(t.fator(sul, '33', 0)).toBeUndefined();
  });

  it('precisa de medida suficiente, esquece o antigo e limita os extremos', () => {
    const t = new TransitoCidade();
    t.registrar(celulas, '85', 0.5, 100, 0); // pouco percurso
    expect(t.fator(celulas, '33', 0)).toBeUndefined();
    t.registrar(celulas, '85', 0.01, 300, 0); // absurdo: vira o limite
    expect(t.fator(celulas, '33', 0)).toBeGreaterThanOrEqual(
      config.transito.fatorMin,
    );
    expect(t.fator(celulas, '33', 31 * MIN)).toBeUndefined();
    t.esquecerAntigos(31 * MIN);
    expect(t.resumo()).toEqual({ celulas: 0, linhas: 0 });
  });
});

describe('VelocidadeTrechos com o trânsito das outras linhas', () => {
  it('a 33 fica mais lenta onde a 85 está mais lenta que o normal', () => {
    const cidade = new TransitoCidade();
    const historico = historicoFixo(36); // normal: 10 m/s
    const nova = (linha: string, tracado = reta) => {
      const v = new VelocidadeTrechos(config.trechos, historico, {
        cidade,
        linha,
      });
      v.definirTracados([{ codigo: linha, tracado }]);
      return v;
    };
    const l85 = nova('85');
    const l33 = nova('33');
    const volta = nova('volta', [...reta].reverse());

    // na 85, 0–300 m em 60 s: 5 m/s, metade do normal
    l85.observar('85', 'A', em(0), 0);
    l85.observar('85', 'A', em(300), MIN);

    expect(l85.velocidades('85', MIN)!.kmh[0]).toBe(18); // medido
    const t33 = l33.velocidades('33', MIN)!;
    expect(t33.kmh[0]).toBe(18); // 36 × 0,5
    expect(t33.kmh[3]).toBe(36); // rua sem notícia: o normal
    // a volta passa na mesma rua, no outro sentido: nada muda
    expect(volta.velocidades('volta', MIN)!.kmh.every((k) => k === 36)).toBe(
      true,
    );
  });
});
