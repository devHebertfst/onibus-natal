import { RotaMetros } from './rota.js';
import { VelocidadeTrechos } from './trechos.js';

/** Avenida reta de 2 km rumo ao norte, com um ponto a cada 100 m. */
const M = 1 / 111_195;
const reta: [number, number][] = Array.from({ length: 21 }, (_, i) => [
  -5.8 + i * 100 * M,
  -35.2,
]);
const em = (metros: number, deslocamentoM = 0) => ({
  lat: -5.8 + metros * M,
  lng: -35.2 + deslocamentoM * M,
});
const S = 1000;

describe('RotaMetros', () => {
  it('mede a distância ao longo do traçado e até ele', () => {
    const rota = new RotaMetros(reta);
    expect(rota.comprimento).toBeCloseTo(2000, 0);
    const p = rota.projetar(em(550, 20));
    expect(p.s).toBeCloseTo(550, 0);
    expect(p.distancia).toBeCloseTo(20, 0);
  });

  it('usa a dica quando o traçado passa duas vezes no mesmo lugar', () => {
    const vaiEVolta = new RotaMetros([
      ...reta,
      ...[...reta].reverse().slice(1),
    ]);
    expect(vaiEVolta.projetar(em(500), 450).s).toBeCloseTo(500, 0);
    expect(vaiEVolta.projetar(em(500), 3400).s).toBeCloseTo(3500, 0);
  });
});

describe('VelocidadeTrechos', () => {
  const novo = () => {
    const v = new VelocidadeTrechos();
    v.definirTracados([
      { codigo: 'ida', tracado: reta },
      { codigo: 'volta', tracado: [...reta].reverse() },
    ]);
    return v;
  };

  it('mede cada trecho pelo tempo que os ônibus levaram para percorrê-lo', () => {
    const v = novo();
    // 0–600 m a 10 m/s; 600–900 m a 2,5 m/s (trânsito)
    v.observar('ida', 'A', em(0), 0);
    v.observar('ida', 'A', em(300), 30 * S);
    v.observar('ida', 'A', em(600), 60 * S);
    v.observar('ida', 'A', em(900), 180 * S);

    const t = v.velocidades('ida', 180 * S)!;
    expect(t.tamanhoM).toBe(300);
    expect(t.kmh).toHaveLength(7); // 2000 m / 300 m
    expect(t.kmh.slice(0, 4)).toEqual([36, 36, 9, null]);
    // 900 m em 180 s, com o mais recente pesando um pouco mais
    expect(t.mediaKmh).toBeGreaterThan(16);
    expect(t.mediaKmh).toBeLessThanOrEqual(18);
  });

  it('reparte o tempo entre os trechos cobertos e conta o tempo parado', () => {
    const v = novo();
    v.observar('ida', 'A', em(100), 0);
    // ficou um tempo parado no ponto e depois andou até 500 m: 400 m em 90 s
    v.observar('ida', 'A', em(500), 90 * S);
    const t = v.velocidades('ida', 90 * S)!;
    expect(t.kmh[0]).toBe(16); // 2/3 do trecho 0 foram percorridos
    expect(t.kmh[1]).toBe(16);
  });

  it('ignora quem anda no sentido contrário, longe do traçado ou aos saltos', () => {
    const v = novo();
    // no traçado da ida, um ônibus da volta "anda para trás"
    v.observar('ida', 'B', em(900), 0);
    v.observar('ida', 'B', em(600), 30 * S);
    // fora do traçado (garagem)
    v.observar('ida', 'C', em(0, 200), 0);
    v.observar('ida', 'C', em(300, 200), 30 * S);
    // 1500 m em 30 s = 180 km/h: GPS errado
    v.observar('ida', 'D', em(0), 0);
    v.observar('ida', 'D', em(1500), 30 * S);
    // 10 min entre as posições: não dá para saber o que houve
    v.observar('ida', 'E', em(0), 0);
    v.observar('ida', 'E', em(300), 600 * S);

    expect(v.velocidades('ida', 600 * S)!.kmh.every((k) => k === null)).toBe(
      true,
    );
    // o da volta conta, no traçado dele
    v.observar('volta', 'B', em(900), 0);
    v.observar('volta', 'B', em(600), 30 * S);
    // 1100–1400 m da volta: só o trecho 4 foi coberto o bastante
    expect(v.velocidades('volta', 30 * S)!.kmh.slice(3, 5)).toEqual([null, 36]);
  });

  it('não conta duas vezes a mesma posição de GPS', () => {
    const v = novo();
    v.observar('ida', 'A', em(0), 0);
    v.observar('ida', 'A', em(300), 30 * S);
    v.observar('ida', 'A', em(300), 30 * S);
    v.observar('ida', 'A', em(300), 30 * S);
    expect(v.velocidades('ida', 30 * S)!.kmh[0]).toBe(36);
  });

  it('dá mais peso ao trânsito recente e esquece o antigo', () => {
    const v = novo();
    v.observar('ida', 'A', em(0), 0);
    v.observar('ida', 'A', em(300), 30 * S); // 36 km/h
    const minuto = 60 * S;
    v.observar('ida', 'B', em(0), 20 * minuto);
    v.observar('ida', 'B', em(300), 20 * minuto + 120 * S); // 9 km/h
    const kmh = v.velocidades('ida', 22 * minuto)!.kmh[0]!;
    // o antigo pesa 1/4 (duas meias-vidas): bem mais perto de 9 que de 36
    expect(kmh).toBeGreaterThan(9);
    expect(kmh).toBeLessThan(13);

    expect(v.velocidades('ida', 60 * minuto)!.kmh[0]).toBeNull();
  });

  it('recomeça quando o traçado muda e esquece itinerários que sumiram', () => {
    const v = novo();
    v.observar('ida', 'A', em(0), 0);
    v.observar('ida', 'A', em(300), 30 * S);
    v.definirTracados([{ codigo: 'ida', tracado: reta.slice(0, 11) }]);
    const t = v.velocidades('ida', 30 * S)!;
    expect(t.kmh).toEqual([null, null, null, null]);
    expect(v.velocidades('volta', 30 * S)).toBeUndefined();
  });
});
