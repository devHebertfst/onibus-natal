import { Linha } from '../../core/linha.models';
import { Frota } from './frota';
import { OnibusAnimado } from './onibus-animado';
import { PerfilVelocidade } from './perfil-velocidade';
import { preverChegadas } from './previsao';
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

  it('com velocidade desconhecida e sentido conhecido, anda na velocidade comercial', () => {
    const o = new OnibusAnimado('1');
    o.atualizar(em(500), null, 0, [ida], 0); // só um itinerário: sentido conhecido
    expect(o.rota?.codigo).toBe('ida');
    o.quadro(0);
    const q = o.quadro(10_000)!;
    // 10 s a 18 km/h (5 m/s): ~50 m
    expect(ida.projetar(q.lat, q.lng).s).toBeCloseTo(550, 0);
  });

  it('com velocidade desconhecida, anda no ritmo que os ônibus da linha fazem no trecho', () => {
    const rota = new Rota('ida', reta);
    rota.perfil = new PerfilVelocidade({ tamanhoM: 300, kmh: [null, 36, null], mediaKmh: 20 });
    const o = new OnibusAnimado('1');
    o.atualizar(em(400), null, 0, [rota], 0);
    o.quadro(0);
    const q = o.quadro(10_000)!;
    // trecho 300–600 m medido a 36 km/h (10 m/s): ~100 m em 10 s
    expect(rota.projetar(q.lat, q.lng).s).toBeCloseTo(500, 0);
  });

  it('com velocidade desconhecida, não estima perto do terminal nem quando parado é certo', () => {
    const noTerminal = new OnibusAnimado('1');
    noTerminal.atualizar(em(100), null, 0, [ida], 0);
    noTerminal.quadro(0);
    expect(ida.projetar(...latLng(noTerminal.quadro(10_000)!)).s).toBeCloseTo(100, 0);

    const parado = new OnibusAnimado('2');
    parado.atualizar(em(500), 0, 0, [ida], 0);
    parado.quadro(0);
    expect(ida.projetar(...latLng(parado.quadro(10_000)!)).s).toBeCloseTo(500, 0);
  });

  it('não extrapola indefinidamente sem posição nova', () => {
    const o = new OnibusAnimado('1');
    o.atualizar(em(0), kmh36, 0, [ida], 0);
    o.atualizar(em(200), kmh36, 20_000, [ida], 20_000);
    const q = o.quadro(600_000)!;
    expect(ida.projetar(q.lat, q.lng).s).toBeCloseTo(800, 0); // 200 + 60 s · 10 m/s
  });
});

describe('PerfilVelocidade', () => {
  it('soma o tempo trecho a trecho, com a média da linha onde não há medida', () => {
    const p = new PerfilVelocidade({ tamanhoM: 300, kmh: [36, 9, null], mediaKmh: 18 });
    expect(p.medido).toBe(true);
    // 150 m a 10 m/s + 300 m a 2,5 m/s + 150 m a 5 m/s
    expect(p.segundosEntre(150, 750)).toBeCloseTo(15 + 120 + 30, 6);
    expect(p.velocidadeEm(450)).toBeCloseTo(2.5, 6);
    expect(p.velocidadeEm(5000)).toBeCloseTo(5, 6); // além do último trecho: a média
    expect(p.segundosEntre(750, 150)).toBe(0);
  });

  it('sem medida nenhuma, usa 18 km/h; medidas absurdas são limitadas', () => {
    const vazio = new PerfilVelocidade();
    expect(vazio.medido).toBe(false);
    expect(vazio.segundosEntre(0, 300)).toBeCloseTo(60, 6);
    const extremo = new PerfilVelocidade({ tamanhoM: 300, kmh: [1, 200], mediaKmh: null });
    expect(extremo.velocidadeEm(0)).toBeCloseTo(5 / 3.6, 6);
    expect(extremo.velocidadeEm(300)).toBeCloseTo(60 / 3.6, 6);
  });
});

describe('preverChegadas', () => {
  it('lista os ônibus que ainda vão passar pela parada, do mais próximo ao mais longe', () => {
    const paradas = [0, 1000, 1500].map((m, i) => ({
      codigo: `P${i}`,
      descricao: '',
      ordem: i,
      lat: em(m)[0],
      lng: em(m)[1],
    }));
    const linha = (t: number, pos: Record<string, number>): Linha => ({
      numero: '1',
      atualizadoEm: new Date(t).toISOString(),
      desatualizado: false,
      itinerarios: [{ codigo: 'ida', descricao: 'IDA', tracado: reta, paradas }],
      onibus: Object.entries(pos).map(([id, m]) => ({
        id,
        lat: em(m)[0],
        lng: em(m)[1],
        velocidadeKmh: 36,
        itinerarios: ['ida'],
        posicaoDesde: new Date(t).toISOString(),
      })),
    });

    const frota = new Frota();
    frota.sincronizar(linha(0, { A: 100, B: 600, C: 1200 }), 0);
    frota.sincronizar(linha(20_000, { A: 200, B: 700, C: 1300 }), 20_000);
    for (const o of frota.onibus.values()) o.quadro(20_000);

    const p = preverChegadas(frota, 'ida', paradas, 'P1');
    expect(p.map((x) => x.onibus)).toEqual(['B', 'A']); // C já passou
    expect(p[0].metros).toBeCloseTo(300, -1);
    expect(p[0].minutos).toBeCloseTo(1, 0); // 300 m a 18 km/h

    // Com os ônibus medindo o caminho: 700–900 m a 36 km/h (20 s) e
    // 900–1000 m a 9 km/h, num trecho engarrafado (40 s).
    const medida = linha(40_000, { A: 300, B: 800, C: 1400 });
    medida.itinerarios[0].trechos = { tamanhoM: 300, kmh: [null, null, 36, 9], mediaKmh: 20 };
    frota.sincronizar(medida, 40_000);
    for (const o of frota.onibus.values()) o.quadro(40_000);
    const b = preverChegadas(frota, 'ida', paradas, 'P1').find((x) => x.onibus === 'B')!;
    expect(b.metros).toBeCloseTo(200, -1);
    expect(b.minutos * 60).toBeCloseTo(10 + 40, -1);
  });
});

function latLng(q: { lat: number; lng: number }): [number, number] {
  return [q.lat, q.lng];
}
