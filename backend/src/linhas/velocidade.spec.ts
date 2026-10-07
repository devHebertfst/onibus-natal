import { RastreadorVelocidade } from './velocidade.js';

/** Deslocamento para o norte: 1° de latitude ≈ 111,2 km. */
const norte = (metros: number) => ({
  lat: -5.8 + metros / 111_195,
  lng: -35.2,
});

describe('RastreadorVelocidade', () => {
  it('calcula a média do caminho percorrido na janela', () => {
    const r = new RastreadorVelocidade();
    // 10 m/s (36 km/h), uma posição nova a cada 20s
    for (let i = 0; i <= 4; i++) r.registrar('A', norte(i * 200), i * 20_000);
    expect(r.velocidadeKmh('A', 80_000)).toBeCloseTo(36, 0);
  });

  it('suaviza oscilações usando a janela inteira', () => {
    const r = new RastreadorVelocidade();
    // trechos de 100m e 300m alternados a cada 20s: média de 10 m/s
    const passos = [0, 100, 400, 500, 800];
    passos.forEach((m, i) => r.registrar('A', norte(m), i * 20_000));
    expect(r.velocidadeKmh('A', 80_000)).toBeCloseTo(36, 0);
  });

  it('ignora repetições da mesma posição (GPS ainda não atualizou)', () => {
    const r = new RastreadorVelocidade();
    r.registrar('A', norte(0), 0);
    r.registrar('A', norte(0), 15_000); // mesmo GPS
    r.registrar('A', norte(250), 25_000);
    expect(r.velocidadeKmh('A', 25_000)).toBeCloseTo(36, 0);
    expect(r.posicaoDesde('A')).toBe(25_000);
  });

  it('considera parado quem não se move há mais de 60s', () => {
    const r = new RastreadorVelocidade();
    r.registrar('A', norte(0), 0);
    r.registrar('A', norte(200), 20_000);
    r.registrar('A', norte(203), 50_000); // ruído de GPS < 10m
    expect(r.velocidadeKmh('A', 75_000)).toBeGreaterThan(0);
    expect(r.velocidadeKmh('A', 81_000)).toBe(0);
  });

  it('descarta posições fora da janela de 90s', () => {
    const r = new RastreadorVelocidade();
    // começa rápido (20 m/s) e depois desacelera para 5 m/s
    let m = 0;
    for (let t = 0; t <= 100_000; t += 20_000)
      r.registrar('A', norte((m += 400)), t);
    for (let t = 120_000; t <= 240_000; t += 20_000)
      r.registrar('A', norte((m += 100)), t);
    expect(r.velocidadeKmh('A', 240_000)).toBeCloseTo(18, 0);
  });

  it('reinicia o histórico diante de um salto impossível', () => {
    const r = new RastreadorVelocidade();
    r.registrar('A', norte(0), 0);
    r.registrar('A', norte(200), 20_000);
    r.registrar('A', norte(5_000), 40_000); // 240 m/s
    expect(r.velocidadeKmh('A', 40_000)).toBe(0);
    r.registrar('A', norte(5_200), 60_000);
    expect(r.velocidadeKmh('A', 60_000)).toBeCloseTo(36, 0);
  });

  it('esquece veículos que sumiram', () => {
    const r = new RastreadorVelocidade();
    r.registrar('A', norte(0), 0);
    r.esquecerAntigos(11 * 60_000);
    expect(r.posicaoDesde('A')).toBeUndefined();
  });
});
