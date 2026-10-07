import { Itinerario } from './linha.models';
import { acharPonto, agruparParadas, pontosProximos } from './pontos';
import { destino, distanciaTexto, nomeParada } from './texto';

const M = 1 / 111_195;
const parada = (codigo: string, ordem: number, metrosNorte: number, metrosLeste = 0) => ({
  codigo,
  ordem,
  descricao: `Rua ${codigo}, 100 - Centro, Natal - RN, 59000-000, Brazil`,
  lat: -5.8 + metrosNorte * M,
  lng: -35.2 + metrosLeste * M,
});

const itinerarios: Itinerario[] = [
  {
    codigo: 'ida',
    descricao: '33 - CIDADE NOVA / RIBEIRA (IDA)',
    tracado: [],
    paradas: [parada('A1', 1, 0), parada('A2', 2, 500)],
  },
  // B1 fica do outro lado da rua de A2 (20 m); B2 é só da volta.
  {
    codigo: 'volta',
    descricao: '33 - RIBEIRA / CIDADE NOVA (VOLTA)',
    tracado: [],
    paradas: [parada('B1', 1, 500, 20), parada('B2', 2, 1500)],
  },
];

describe('agruparParadas', () => {
  it('junta ida e volta no mesmo lugar num ponto só, com os dois sentidos', () => {
    const pontos = agruparParadas(itinerarios);
    expect(pontos).toHaveLength(3);
    const meio = acharPonto(pontos, 'B1')!;
    expect(meio.sentidos.map((s) => s.itinerario)).toEqual(['ida', 'volta']);
    expect(meio.nome).toBe('Rua A2, 100 - Centro');
    expect(acharPonto(pontos, 'ida|A2')).toBe(meio);
  });

  it('ordena os pontos pela distância até o passageiro', () => {
    const pontos = agruparParadas(itinerarios);
    const perto = pontosProximos(pontos, -5.8 + 1400 * M, -35.2, 2);
    expect(perto.map((p) => p.ponto.sentidos[0].parada.codigo)).toEqual(['B2', 'A2']);
    expect(perto[0].metros).toBeCloseTo(100, -1);
  });
});

describe('texto', () => {
  it('mostra o destino como numa placa', () => {
    expect(destino('33 - CIDADE NOVA / RIBEIRA (IDA)')).toBe('Cidade Nova / Ribeira');
    expect(destino('O-54 - VIA UFRN DE PONTA NEGRA')).toBe('Via UFRN de Ponta Negra');
  });

  it('tira CEP, cidade e país do nome da parada', () => {
    expect(
      nomeParada('Av. Eng. Roberto Freire, 1234 - Ponta Negra, Natal - RN, 59090-000, Brazil'),
    ).toBe('Av. Eng. Roberto Freire, 1234 - Ponta Negra');
  });

  it('formata distância a pé', () => {
    expect(distanciaTexto(343)).toBe('340\u00a0m');
    expect(distanciaTexto(1234)).toBe('1,2\u00a0km');
  });
});
