import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { NubusClient } from '../nubus/nubus.client.js';
import { CatalogoRotasService } from '../nubus/catalogo-rotas.service.js';
import { ParadasService } from './paradas.service.js';

function fakeClient() {
  const itinerarios = [
    {
      codigoItinerario: 'A',
      descricaoItinerario: 'Planalto / Praia do Meio',
      descricaolinha: 'O-33',
      codigolinha: 'CDNO-33',
    },
    {
      codigoItinerario: 'B',
      descricaoItinerario: 'Planalto / Mae Luiza',
      descricaolinha: 'O-33 Extra',
      codigolinha: 'CDNO-33',
    },
    {
      codigoItinerario: 'C',
      descricaoItinerario: 'Ida',
      descricaolinha: 'N-73',
      codigolinha: 'CDNN-73',
    },
  ];
  const paradasPor: Record<string, string[]> = {
    A: ['PARADA#1', 'PARADA#2'],
    B: ['PARADA#1'],
    C: ['PARADA#1', 'PARADA#3'],
  };
  const posicao: Record<string, [number, number]> = {
    'PARADA#1': [-5.8, -35.2],
    'PARADA#2': [-5.803, -35.2], // ~330 m ao sul
    'PARADA#3': [-5.9, -35.2], // ~11 km
    'PARADA#4': [-5.8001, -35.2], // nenhuma linha passa
  };
  return {
    listarParadas: vi.fn(async () =>
      Object.entries(posicao).map(([codigo, [lat, lng]]) => ({
        codigo,
        Lat: String(lat),
        Long: String(lng),
        descricao: `Rua ${codigo}`,
      })),
    ),
    // A busca é por trecho: cada dígito traz as linhas que o contêm (com repetições).
    pesquisarRotas: vi.fn(async (q: string) =>
      itinerarios.filter((i) => i.descricaolinha.includes(q)),
    ),
    paradasEspecifica: vi.fn(async (codigo: string) => ({
      paradas: paradasPor[codigo].map((c, i) => ({
        codigo: c,
        Lat: posicao[c][0],
        Long: posicao[c][1],
        descricao: c,
        ordem: i,
      })),
    })),
    // Minutos até o próximo ônibus de cada itinerário (pelo nome).
    previsaoParada: vi.fn(
      async (_linha: string, itinerario: string): Promise<unknown[]> => {
        const minutos: Record<string, number[]> = {
          'Planalto / Praia do Meio': [12, 25],
          'Planalto / Mae Luiza': [],
          Ida: [4],
        };
        return minutos[itinerario].map((m) => ({
          tipo: 'On-line',
          Carro: `V${m}`,
          Minutos: m,
        }));
      },
    ),
  };
}

describe('ParadasService', () => {
  it('sinaliza indisponibilidade quando não há itinerários ou nenhum responde', async () => {
    for (const semRotas of [true, false]) {
      const client = fakeClient();
      if (semRotas) client.pesquisarRotas.mockResolvedValue([]);
      else
        client.paradasEspecifica.mockRejectedValue(new Error('Indisponível'));
      const nubus = client as unknown as NubusClient;
      const service = new ParadasService(
        nubus,
        new CatalogoRotasService(nubus),
      );
      await expect(service.proximas(-5.8, -35.2)).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    }
  });
  it('lista as paradas próximas com as linhas que passam em cada uma', async () => {
    const client = fakeClient();
    const nubus = client as unknown as NubusClient;
    const service = new ParadasService(nubus, new CatalogoRotasService(nubus));

    const r = await service.proximas(-5.8, -35.2);

    expect(r.map((p) => p.codigo)).toEqual(['PARADA#1', 'PARADA#2']);
    expect(r[0].metros).toBe(0);
    expect(r[0].linhas).toEqual([
      {
        numero: '33',
        itinerarios: ['Planalto / Praia do Meio', 'Planalto / Mae Luiza'],
      },
      { numero: '73', itinerarios: ['Ida'] },
    ]);
    // Cada itinerário consultado uma vez, mesmo aparecendo em vários dígitos.
    expect(client.paradasEspecifica).toHaveBeenCalledTimes(3);
    expect(client.paradasEspecifica).toHaveBeenCalledWith('A', false);
  });

  it('monta o índice uma vez só, mesmo com pedidos simultâneos', async () => {
    const client = fakeClient();
    const nubus = client as unknown as NubusClient;
    const service = new ParadasService(nubus, new CatalogoRotasService(nubus));
    await Promise.all([
      service.proximas(-5.8, -35.2),
      service.proximas(-5.8, -35.2, 100),
    ]);
    await service.proximas(-5.9, -35.2);
    expect(client.listarParadas).toHaveBeenCalledTimes(1);
  });

  it('respeita o raio e recusa posição inválida', async () => {
    const nubus = fakeClient() as unknown as NubusClient;
    const service = new ParadasService(nubus, new CatalogoRotasService(nubus));
    expect(await service.proximas(-5.8, -35.2, 100)).toHaveLength(1);
    // O raio pedido é limitado a 1,5 km.
    expect(await service.proximas(-5.8, -35.2, 50_000)).toHaveLength(2);
    await expect(service.proximas(NaN, -35.2)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('lista as paradas com linha dentro da área, da mais central à mais longe', async () => {
    const nubus = fakeClient() as unknown as NubusClient;
    const service = new ParadasService(nubus, new CatalogoRotasService(nubus));

    const r = await service.naArea(-5.81, -35.21, -5.799, -35.19);

    // A #3 fica fora da área e a #4 não tem linha; a #2 está mais perto do centro.
    expect(r.map((p) => p.codigo)).toEqual(['PARADA#2', 'PARADA#1']);
    expect(r[0].linhas).toEqual([
      { numero: '33', itinerarios: ['Planalto / Praia do Meio'] },
    ]);
  });

  it('recusa área invertida ou grande demais', async () => {
    const nubus = fakeClient() as unknown as NubusClient;
    const service = new ParadasService(nubus, new CatalogoRotasService(nubus));
    await expect(
      service.naArea(-5.79, -35.21, -5.81, -35.19),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.naArea(-6.2, -35.6, -5.4, -34.8),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.naArea(NaN, -35.21, -5.79, -35.19),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('junta a previsão de cada itinerário da parada, do que chega primeiro ao sem previsão', async () => {
    const client = fakeClient();
    const nubus = client as unknown as NubusClient;
    const service = new ParadasService(nubus, new CatalogoRotasService(nubus));

    const r = await service.previsoes('PARADA#1');

    expect(r.itinerarios.map((i) => [i.numero, i.descricao])).toEqual([
      ['73', 'Ida'],
      ['33', 'Planalto / Praia do Meio'],
      ['33', 'Planalto / Mae Luiza'],
    ]);
    expect(r.itinerarios[1].chegadas).toHaveLength(2);
    expect(r.itinerarios[2].chegadas).toEqual([]);
    expect(client.previsaoParada).toHaveBeenCalledWith(
      'CDNN-73',
      'Ida',
      'PARADA#1',
    );
    // Guardada por 15 s: o segundo pedido não consulta de novo.
    await service.previsoes('PARADA#1');
    expect(client.previsaoParada).toHaveBeenCalledTimes(3);
  });

  it('marca sem previsão o itinerário que falha e recusa parada sem linha', async () => {
    const client = fakeClient();
    client.previsaoParada.mockImplementation(async (_l, itinerario) => {
      if (itinerario === 'Ida') throw new Error('timeout');
      return [];
    });
    const nubus = client as unknown as NubusClient;
    const service = new ParadasService(nubus, new CatalogoRotasService(nubus));

    const r = await service.previsoes('PARADA#1');
    expect(r.itinerarios.find((i) => i.descricao === 'Ida')?.chegadas).toBe(
      null,
    );
    await expect(service.previsoes('PARADA#4')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
