import {
  parseCarros,
  parseParadas,
  parseParadasCidade,
  parsePontos,
  parsePrevisoes,
} from './nubus.parse.js';

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

describe('parsePrevisoes', () => {
  const agora = Date.parse('2026-10-07T22:20:00Z');

  it('preserva fuso explícito e interpreta o GPS sem fuso como hora de Natal', () => {
    const [p] = parsePrevisoes(
      [
        {
          Carro: 'X',
          tipo: 'On-line',
          PrevisaoDeChegada: '2026-10-07T22:30:00.0000001Z',
          gpsVeiculoData: '2026-10-07T19:20:00',
        },
      ],
      agora,
    );
    expect(p.chegaEm).toBe(Date.parse('2026-10-07T22:30:00Z'));
    expect(p.gpsEm).toBe(agora);
  });

  it('lê o horário local de Natal (UTC−3) e separa ao vivo da tabela', () => {
    const r = parsePrevisoes(
      [
        {
          Carro: 'FKEPlanejado',
          tipo: 'Off-line',
          Minutos: 60,
          PrevisaoDeChegada: '2026-10-07T20:20:00.0000001',
          distanciaVeiculoMetros: 32694,
          gpsVeiculoData: '2026-10-07T22:50:00+00:00',
        },
        {
          Carro: 'CDN70061',
          tipo: 'On-line',
          Minutos: 14,
          PrevisaoDeChegada: '2026-10-07T19:34:28.0000001',
          distanciaVeiculoMetros: 4702.4,
          gpsVeiculoData: '2026-10-07T22:19:46+00:00',
        },
      ],
      agora,
    );
    expect(r).toEqual([
      {
        onibus: 'CDN70061',
        aoVivo: true,
        chegaEm: Date.parse('2026-10-07T22:34:28Z'),
        metros: 4702,
        gpsEm: Date.parse('2026-10-07T22:19:46Z'),
      },
      {
        onibus: null,
        aoVivo: false,
        chegaEm: Date.parse('2026-10-07T23:20:00Z'),
        metros: null,
        gpsEm: null,
      },
    ]);
  });

  it('sem horário legível, usa agora + Minutos; descarta ao vivo sem carro', () => {
    const r = parsePrevisoes(
      [
        { Carro: 'X1', tipo: 'On-line', Minutos: '3', PrevisaoDeChegada: '' },
        { Carro: '', tipo: 'On-line', Minutos: 1 },
        { Carro: 'X2', tipo: 'On-line' },
      ],
      agora,
    );
    expect(r.map((c) => [c.onibus, c.chegaEm])).toEqual([
      ['X1', agora + 3 * 60_000],
    ]);
  });
});

describe('parseParadasCidade', () => {
  it('converte e descarta paradas sem código ou posição', () => {
    expect(
      parseParadasCidade([
        {
          codigo: 'PARADA#1',
          Lat: '-5.8',
          Long: '-35.2',
          descricao: ' Rua A ',
        },
        { codigo: 'PARADA#2', Lat: '', Long: '' },
        { codigo: '', Lat: '-5.8', Long: '-35.2' },
      ]),
    ).toEqual([
      { codigo: 'PARADA#1', descricao: 'Rua A', lat: -5.8, lng: -35.2 },
    ]);
  });
});
