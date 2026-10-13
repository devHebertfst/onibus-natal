import type { ItinerarioDto } from './linha.dto.js';
import { PlacarPrevisao } from './placar.js';

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
function percorrer(placar: PlacarPrevisao, aCada?: (segundos: number) => void) {
  for (let s = 0; s <= 420; s += 15) {
    const t = T0 + s * 1000;
    placar.observarLinha(
      [ida],
      [{ id: 'X', itinerarios: ['ida'], ...em(Math.min(2000, 5 * s)), t }],
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
        [ida],
        [{ id: 'L', itinerarios: ['ida'], ...longe, t }],
        t,
      );
    }
    expect(placar.resumo().nossa).toEqual({});
  });
});
