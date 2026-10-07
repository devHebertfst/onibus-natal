import { OnibusAnimado } from './onibus-animado';
import { Rota, distanciaM } from './rota';

/** Avenida reta de 2 km rumo ao norte, com um ponto a cada 100 m. */
const M = 1 / 111_195;
const reta: [number, number][] = Array.from({ length: 21 }, (_, i) => [-5.8 + i * 100 * M, -35.2]);
const ida = new Rota('ida', reta);
const volta = new Rota('volta', [...reta].reverse());
const em = (metros: number): [number, number] => [-5.8 + metros * M, -35.2];

describe('Rota', () => {
  it('projeta, interpola e calcula o rumo', () => {
    expect(ida.comprimento).toBeCloseTo(2000, 0);
    const p = ida.projetar(-5.8 + 550 * M, -35.2 + 20 * M);
    expect(p.s).toBeCloseTo(550, 0);
    expect(p.distancia).toBeGreaterThan(15);
    expect(distanciaM(ida.pontoEm(1234), em(1234))).toBeLessThan(0.5);
    expect(ida.rumoEm(500)).toBeCloseTo(0, 0);
    expect(volta.rumoEm(500)).toBeCloseTo(180, 0);
  });

  it('usa a dica para desambiguar traçados que passam duas vezes no mesmo lugar', () => {
    const vaiEVolta = new Rota('laço', [...reta, ...[...reta].reverse().slice(1)]);
    expect(vaiEVolta.projetar(...em(500), 450).s).toBeCloseTo(500, 0);
    expect(vaiEVolta.projetar(...em(500), 3400).s).toBeCloseTo(3500, 0);
  });
});

describe('OnibusAnimado', () => {
  const kmh36 = 36; // 10 m/s

  it('com uma só posição e ida/volta sobrepostas, não arrisca sentido', () => {
    const o = new OnibusAnimado('1');
    o.atualizar(em(500), kmh36, 0, [ida, volta], 0);
    expect(o.rota).toBeNull();
    expect(o.quadro(10_000)).toMatchObject({ lat: em(500)[0] });
  });

  it('infere o sentido por duas posições consecutivas e extrapola ao longo do traçado', () => {
    const o = new OnibusAnimado('1');
    o.atualizar(em(500), kmh36, 0, [ida, volta], 0);
    o.atualizar(em(400), kmh36, 20_000, [ida, volta], 20_000);
    expect(o.rota?.codigo).toBe('volta');

    o.quadro(20_000);
    o.quadro(21_000); // passa a transição
    const q = o.quadro(30_000)!;
    // 10 s a 10 m/s rumo ao sul: ~300 m
    expect(distanciaM([q.lat, q.lng], em(300))).toBeLessThan(5);
    expect(q.rumo).toBeCloseTo(180, 0);
  });

  it('corrige suavemente (sem saltar) quando chega a posição real', () => {
    const o = new OnibusAnimado('1');
    o.atualizar(em(0), kmh36, 0, [ida], 0);
    o.atualizar(em(200), kmh36, 20_000, [ida], 20_000);
    for (let t = 20_000; t <= 40_000; t += 16) o.quadro(t);
    // desenhado em ~400 m; a posição real diz 350 m (ficou para trás)
    o.atualizar(em(350), kmh36, 40_000, [ida], 40_000);

    let anterior = ida.projetar(...latLng(o.quadro(40_016)!)).s;
    for (let t = 40_032; t <= 50_000; t += 16) {
      const s = ida.projetar(...latLng(o.quadro(t)!)).s;
      expect(s).toBeGreaterThanOrEqual(anterior - 1e-6); // nunca anda de ré
      expect(s - anterior).toBeLessThan(1); // nem dá saltos (< 1 m por quadro)
      anterior = s;
    }
    // converge para a trajetória real: 350 + 10 m/s · 10 s
    expect(anterior).toBeCloseTo(450, -1);
  });

  it('não extrapola indefinidamente sem posição nova', () => {
    const o = new OnibusAnimado('1');
    o.atualizar(em(0), kmh36, 0, [ida], 0);
    o.atualizar(em(200), kmh36, 20_000, [ida], 20_000);
    const q = o.quadro(600_000)!;
    expect(ida.projetar(q.lat, q.lng).s).toBeCloseTo(600, 0); // 200 + 40 s · 10 m/s
  });
});

function latLng(q: { lat: number; lng: number }): [number, number] {
  return [q.lat, q.lng];
}
