import {
  type ItinerarioMalha,
  planejarRotas,
  tracadoEntre,
} from './roteador.js';

/** Itinerário com paradas a cada ~550 m entre dois pontos. */
function itinerario(
  numero: string,
  de: [number, number],
  ate: [number, number],
  n = 11,
): ItinerarioMalha {
  const paradas = Array.from({ length: n }, (_, i) => ({
    codigo: `${numero}#${i}`,
    descricao: `Parada ${i} da ${numero}`,
    lat: de[0] + ((ate[0] - de[0]) * i) / (n - 1),
    lng: de[1] + ((ate[1] - de[1]) * i) / (n - 1),
  }));
  return {
    numero,
    codigo: `IT-${numero}`,
    descricao: `Linha ${numero}`,
    codigolinha: `CD-${numero}`,
    paradas,
    tracado: paradas.map(({ lat, lng }) => ({ lat, lng })),
  };
}

// A 10 corre de oeste para leste; a 20 desce do fim da 10 para o sul.
const linha10 = itinerario('10', [-5.8, -35.25], [-5.8, -35.2]);
const linha20 = itinerario('20', [-5.8005, -35.2], [-5.85, -35.2]);
const malha = [linha10, linha20];

describe('planejarRotas', () => {
  it('sugere andar até a parada e pegar o ônibus direto', () => {
    const rotas = planejarRotas(
      malha,
      { lat: -5.803, lng: -35.245 },
      { lat: -5.802, lng: -35.21 },
    );
    expect(rotas).toHaveLength(1);
    expect(rotas[0].pernas).toEqual([
      { itinerario: linha10, embarque: 1, desembarque: 8 },
    ]);
  });

  it('combina dois ônibus quando nenhum vai sozinho até o destino', () => {
    const rotas = planejarRotas(
      malha,
      { lat: -5.801, lng: -35.245 },
      { lat: -5.845, lng: -35.199 },
    );
    expect(rotas).toHaveLength(1);
    const [primeiro, segundo] = rotas[0].pernas;
    expect([primeiro.itinerario.numero, segundo.itinerario.numero]).toEqual([
      '10',
      '20',
    ]);
    expect(primeiro).toMatchObject({ embarque: 1, desembarque: 10 });
    expect(segundo).toMatchObject({ embarque: 0, desembarque: 9 });
  });

  it('respeita o sentido do itinerário e a distância a pé', () => {
    // A 10 só vai para leste: de leste para oeste não há ônibus.
    expect(
      planejarRotas(
        malha,
        { lat: -5.8, lng: -35.21 },
        { lat: -5.8, lng: -35.245 },
      ),
    ).toEqual([]);
    // Longe demais de qualquer parada.
    expect(
      planejarRotas(
        malha,
        { lat: -5.9, lng: -35.3 },
        { lat: -5.845, lng: -35.199 },
      ),
    ).toEqual([]);
  });

  it('recorta o traçado entre o embarque e o desembarque', () => {
    const tracado = tracadoEntre({
      itinerario: linha10,
      embarque: 2,
      desembarque: 5,
    });
    expect(tracado[0]).toEqual([
      linha10.paradas[2].lat,
      linha10.paradas[2].lng,
    ]);
    expect(tracado.at(-1)).toEqual([
      linha10.paradas[5].lat,
      linha10.paradas[5].lng,
    ]);
    expect(tracado.length).toBeLessThan(linha10.tracado.length);
  });
});
