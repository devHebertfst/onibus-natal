import { respostaTrajeto } from '../../test/fixtures/trajeto.js';
import { decodificarPolyline, parseTrajetos } from './trajeto.parse.js';

describe('decodificarPolyline', () => {
  it('decodifica deltas negativos e positivos na precisão Google', () => {
    expect(decodificarPolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });
  it('recusa geometria truncada ou caracteres inválidos', () => {
    expect(() => decodificarPolyline('xvjb@')).toThrow();
    expect(() => decodificarPolyline(' ')).toThrow();
  });
});

describe('parseTrajetos', () => {
  it('normaliza caminhada, ônibus, espera entre trechos e horários', () => {
    const [v] = parseTrajetos(respostaTrajeto());
    expect(v.duracaoSegundos).toBe(1800); // inclui a espera de 5 min no ponto
    expect(v.caminhadaMetros).toBe(350);
    expect(v.trechos[0].tracado).toHaveLength(2);
    expect(v.trechos[1]).toMatchObject({
      modo: 'BUS',
      linha: '33',
      letreiro: 'Praia do Meio',
    });
    expect(v.trechos[1].tracado).toEqual([]); // não inventa um caminho sem geometria
  });
  it('aceita envelope OTP e resposta sem alternativas', () => {
    expect(parseTrajetos({ plan: respostaTrajeto() })).toHaveLength(1);
    expect(parseTrajetos({ itineraries: [] })).toEqual([]);
  });
  it('preserva alternativa válida quando outra tem geometria quebrada', () => {
    const dados = respostaTrajeto();
    const quebrada = structuredClone(dados.itineraries[0]);
    quebrada.legs[0].legGeometry = { points: 'xvjb@' };
    dados.itineraries.push(quebrada);
    expect(parseTrajetos(dados)).toHaveLength(1);
    expect(() => parseTrajetos({ itineraries: [quebrada] })).toThrow();
    expect(() => parseTrajetos({ error: 'falha' })).toThrow();
  });
});
