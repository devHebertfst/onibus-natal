import { BadRequestException } from '@nestjs/common';
import { NubusClient } from '../nubus/nubus.client.js';
import { ParadasService } from './paradas.service.js';

function fakeClient() {
  const itinerarios = [
    {
      codigoItinerario: 'A',
      descricaoItinerario: 'Planalto / Praia do Meio',
      descricaolinha: 'O-33',
    },
    {
      codigoItinerario: 'B',
      descricaoItinerario: 'Planalto / Mae Luiza',
      descricaolinha: 'O-33 Extra',
    },
    {
      codigoItinerario: 'C',
      descricaoItinerario: 'Ida',
      descricaolinha: 'N-73',
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
  };
}

describe('ParadasService', () => {
  it('lista as paradas próximas com as linhas que passam em cada uma', async () => {
    const client = fakeClient();
    const service = new ParadasService(client as unknown as NubusClient);

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
    const service = new ParadasService(client as unknown as NubusClient);
    await Promise.all([
      service.proximas(-5.8, -35.2),
      service.proximas(-5.8, -35.2, 100),
    ]);
    await service.proximas(-5.9, -35.2);
    expect(client.listarParadas).toHaveBeenCalledTimes(1);
  });

  it('respeita o raio e recusa posição inválida', async () => {
    const service = new ParadasService(fakeClient() as unknown as NubusClient);
    expect(await service.proximas(-5.8, -35.2, 100)).toHaveLength(1);
    // O raio pedido é limitado a 1,5 km.
    expect(await service.proximas(-5.8, -35.2, 50_000)).toHaveLength(2);
    await expect(service.proximas(NaN, -35.2)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
