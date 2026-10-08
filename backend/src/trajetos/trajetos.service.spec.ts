import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { NubusClient } from '../nubus/nubus.client.js';
import { respostaTrajeto } from '../../test/fixtures/trajeto.js';
import { dataNatal, TrajetosService } from './trajetos.service.js';

describe('TrajetosService', () => {
  const planejarTrajeto = vi.fn(async () => respostaTrajeto());
  const service = new TrajetosService({
    planejarTrajeto,
  } as unknown as NubusClient);
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
  it('distingue ausência de trajetos de falha da API', async () => {
    planejarTrajeto.mockResolvedValueOnce({ itineraries: [] });
    await expect(
      service.planejar(-5.8, -35.2, -5.9, -35.2),
    ).resolves.toMatchObject({ viagens: [] });
    planejarTrajeto.mockRejectedValueOnce(new Error('timeout'));
    await expect(
      service.planejar(-5.8, -35.2, -5.9, -35.2),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
