import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { NubusClient } from '../nubus/nubus.client.js';
import { LinhasService, numeroDaLinha } from './linhas.service.js';
import { PrevisaoService } from './previsao.service.js';

function montar(previsao: NubusClient['previsaoParada']) {
  const client = {
    pesquisarRotas: vi.fn(async () => [
      {
        codigoItinerario: 'CDNO-33Planalto / Praia do Meio',
        descricaoItinerario: 'Planalto / Praia do Meio',
        codigolinha: 'CDNO-33',
        descricaolinha: 'O-33',
      },
    ]),
    paradasEspecifica: vi.fn(async () => ({
      pontos: '-5.80 -35.20|-5.81 -35.21',
      paradas: [
        {
          codigo: 'PARADA#1',
          Lat: -5.8,
          Long: -35.2,
          descricao: 'P1',
          ordem: 1,
        },
      ],
      carros: [],
    })),
    previsaoParada: vi.fn(previsao),
  };
  const nubus = client as unknown as NubusClient;
  return {
    client,
    service: new PrevisaoService(new LinhasService(nubus), nubus),
  };
}

const IT = 'CDNO-33Planalto / Praia do Meio';

describe('PrevisaoService', () => {
  beforeEach(() => vi.setSystemTime(new Date('2026-10-07T22:20:00Z')));
  afterEach(() => vi.useRealTimers());

  it('descarta viagens da tabela que já passaram antes de limitar às próximas três', async () => {
    const { service } = montar(async () =>
      [18, 19, 20, 21, 22, 23].map((h) => ({
        tipo: 'Off-line',
        PrevisaoDeChegada: `2026-10-07T${h}:00:00`,
      })),
    );
    const r = await service.obter('33', IT, 'PARADA#1');
    expect(r.chegadas.map((c) => c.chegaEm)).toEqual([
      '2026-10-07T23:00:00.000Z',
      '2026-10-08T00:00:00.000Z',
      '2026-10-08T01:00:00.000Z',
    ]);
  });
  it('pede com a descrição do itinerário e o código da linha, e guarda por 15s', async () => {
    const { client, service } = montar(async () => [
      {
        Carro: 'CDN70061',
        tipo: 'On-line',
        Minutos: 14,
        PrevisaoDeChegada: '2026-10-07T19:34:28.0000001',
        distanciaVeiculoMetros: 4702,
      },
    ]);

    const [a, b] = await Promise.all([
      service.obter('33', IT, 'PARADA#1'),
      service.obter('33', IT, 'PARADA#1'),
    ]);
    await service.obter('33', IT, 'PARADA#1');

    expect(client.previsaoParada).toHaveBeenCalledTimes(1);
    expect(client.previsaoParada).toHaveBeenCalledWith(
      'CDNO-33',
      'Planalto / Praia do Meio',
      'PARADA#1',
    );
    expect(a).toBe(b);
    expect(a.chegadas).toEqual([
      {
        onibus: 'CDN70061',
        aoVivo: true,
        chegaEm: '2026-10-07T22:34:28.000Z',
        metros: 4702,
        gpsEm: null,
      },
    ]);
  });

  it('mantém só as 3 próximas viagens da tabela', async () => {
    const tabela = [1, 2, 3, 4].map((h) => ({
      Carro: 'FKEPlanejado',
      tipo: 'Off-line',
      PrevisaoDeChegada: `2026-10-07T2${h}:00:00`,
    }));
    const { service } = montar(async () => tabela);
    const r = await service.obter('33', IT, 'PARADA#1');
    expect(r.chegadas).toHaveLength(3);
    expect(r.chegadas.every((c) => !c.aoVivo && c.onibus === null)).toBe(true);
  });

  it('recusa parada de fora do itinerário sem consultar a API', async () => {
    const { client, service } = montar(async () => []);
    await expect(service.obter('33', IT, 'PARADA#999')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.obter('33', 'outro', 'PARADA#1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(client.previsaoParada).not.toHaveBeenCalled();
  });

  it('falha da API vira 502, e a próxima chamada tenta de novo', async () => {
    let falhar = true;
    const { client, service } = montar(async () => {
      if (falhar) throw new Error('timeout');
      return [];
    });
    await expect(service.obter('33', IT, 'PARADA#1')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    falhar = false;
    await expect(service.obter('33', IT, 'PARADA#1')).resolves.toMatchObject({
      chegadas: [],
    });
    expect(client.previsaoParada).toHaveBeenCalledTimes(2);
  });
});

describe('numeroDaLinha', () => {
  it('tira o prefixo da operadora, o "Extra" e os zeros à esquerda', () => {
    expect(numeroDaLinha('O-33 Extra')).toBe('33');
    expect(numeroDaLinha('N-073')).toBe('73');
    expect(numeroDaLinha('SE17')).toBe('SE17');
    expect(numeroDaLinha('745.1')).toBe('745.1');
  });
});
