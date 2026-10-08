import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { NubusClient } from '../nubus/nubus.client.js';
import { ParadasService } from '../paradas/paradas.service.js';
import { respostaTrajeto } from '../../test/fixtures/trajeto.js';
import { dataNatal, TrajetosService } from './trajetos.service.js';

describe('TrajetosService', () => {
  const planejarTrajeto = vi.fn(async () => respostaTrajeto());
  const malha = vi.fn(async () => []);
  const service = new TrajetosService(
    { planejarTrajeto } as unknown as NubusClient,
    { malha } as unknown as ParadasService,
  );
  beforeEach(() =>
    planejarTrajeto.mockReset().mockResolvedValue(respostaTrajeto()),
  );

  it('envia a hora de Natal ao endpoint mesmo com o servidor em UTC', async () => {
    expect(dataNatal(Date.parse('2026-10-08T11:00:00Z'))).toBe(
      '2026-10-08 08:00:00',
    );
    const r = await service.planejar(
      -5.7945,
      -35.211,
      -5.835,
      -35.207,
      '2026-10-08T08:00',
    );
    expect(planejarTrajeto).toHaveBeenCalledWith(
      -5.7945,
      -35.211,
      -5.835,
      -35.207,
      '2026-10-08 08:00:00',
    );
    expect(r.viagens).toHaveLength(1);
  });
  it('recusa coordenadas e datas inválidas sem consultar a Nubus', async () => {
    await expect(
      service.planejar(NaN, -35.2, -5.8, -35.2),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.planejar(-91, -35.2, -5.8, -35.2),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.planejar(-5.8, -35.2, -5.9, -35.2, '2026-02-30T08:00'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.planejar(-5.8, -35.2, -5.9, -35.2, ''),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(planejarTrajeto).not.toHaveBeenCalled();
  });
  it('só falha se os dois planejadores falharem', async () => {
    // Sem ônibus nem resposta da Nubus, ainda dá para ir a pé.
    planejarTrajeto.mockResolvedValueOnce({ itineraries: [] });
    const r = await service.planejar(-5.8, -35.2, -5.81, -35.2);
    expect(r.viagens).toHaveLength(1);
    expect(r.viagens[0].trechos.map((t) => t.modo)).toEqual(['WALK']);

    planejarTrajeto.mockRejectedValueOnce(new Error('timeout'));
    malha.mockRejectedValueOnce(new Error('sem índice'));
    await expect(
      service.planejar(-5.8, -35.2, -5.9, -35.2),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('monta a viagem do planejador próprio com a previsão do ponto de embarque', async () => {
    const paradas = [0, 1, 2, 3].map((i) => ({
      codigo: `P${i}`,
      descricao: `Parada ${i}`,
      lat: -5.8 - i * 0.01,
      lng: -35.2,
    }));
    malha.mockResolvedValueOnce([
      {
        numero: '33',
        codigo: 'IT33',
        descricao: 'Planalto / Ribeira',
        codigolinha: 'CDNO-33',
        paradas,
        tracado: [],
      },
    ] as never);
    planejarTrajeto.mockRejectedValueOnce(new Error('timeout'));
    const agora = Date.now();
    const previsaoParada = vi.fn(async () => [
      { tipo: 'On-line', Carro: 'X', Minutos: 6 },
    ]);
    const comPrevisao = new TrajetosService(
      { planejarTrajeto, previsaoParada } as unknown as NubusClient,
      { malha } as unknown as ParadasService,
    );

    const r = await comPrevisao.planejar(-5.8003, -35.2004, -5.8298, -35.2);

    const viagem = r.viagens[0];
    expect(viagem.trechos.map((t) => [t.modo, t.linha])).toEqual([
      ['WALK', null],
      ['BUS', '33'],
    ]);
    const onibus = viagem.trechos[1];
    expect(onibus.fonteHorario).toBe('ao-vivo');
    expect(Date.parse(onibus.inicio) - agora).toBeGreaterThan(5 * 60_000);
    expect(Date.parse(onibus.inicio) - agora).toBeLessThan(7 * 60_000);
    expect(previsaoParada).toHaveBeenCalledWith(
      'CDNO-33',
      'Planalto / Ribeira',
      'P0',
    );
  });
});
