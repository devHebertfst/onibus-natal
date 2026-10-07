import { parseCarros, parseParadas, parsePontos } from './nubus.parse.js';

describe('parsePontos', () => {
  it('converte "lat long|lat long" e ignora lixo e repetições', () => {
    const pontos =
      '-5.80 -35.20|-5.80 -35.20| |-5.81 -35.21|abc def|-5,82 -35,22|';
    expect(parsePontos(pontos)).toEqual([
      { lat: -5.8, lng: -35.2 },
      { lat: -5.81, lng: -35.21 },
      { lat: -5.82, lng: -35.22 },
    ]);
  });

  it('aceita vazio/nulo', () => {
    expect(parsePontos(null)).toEqual([]);
    expect(parsePontos('')).toEqual([]);
  });
});

describe('parseParadas', () => {
  it('converte campos e ordena por ordem', () => {
    const r = parseParadas([
      { codigo: 2, Lat: '-5.81', Long: '-35.21', descricao: ' B ', ordem: '2' },
      { codigo: 1, Lat: -5.8, Long: -35.2, descricao: 'A', ordem: 1 },
      { codigo: 3, Lat: 0, Long: 0, descricao: 'inválida', ordem: 3 },
    ]);
    expect(r.map((p) => p.codigo)).toEqual(['1', '2']);
    expect(r[1]).toMatchObject({ descricao: 'B', lat: -5.81, lng: -35.21 });
  });
});

describe('parseCarros', () => {
  it('converte e descarta carros sem posição', () => {
    expect(
      parseCarros([
        { carro: 12345, Lat: '-5.8', Long: '-35.2' },
        { carro: '999', Lat: '', Long: '' },
      ]),
    ).toEqual([{ id: '12345', lat: -5.8, lng: -35.2 }]);
  });
});
