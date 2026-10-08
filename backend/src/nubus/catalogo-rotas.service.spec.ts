import { BadGatewayException } from '@nestjs/common';
import { CatalogoRotasService } from './catalogo-rotas.service.js';
import { NubusClient } from './nubus.client.js';

describe('CatalogoRotasService', () => {
  it('agrupa variantes, normaliza números e compartilha rotas com pedidos simultâneos', async () => {
    const pesquisarRotas = vi.fn(async (q: string) =>
      [
        {
          codigoItinerario: 'A',
          descricaolinha: 'O-33',
          descricaoItinerario: 'Planalto / Praia do Meio',
        },
        {
          codigoItinerario: 'B',
          descricaolinha: 'O-33 Extra',
          descricaoItinerario: 'Planalto / Mãe Luiza',
        },
        {
          codigoItinerario: 'C',
          descricaolinha: 'N-073',
          descricaoItinerario: 'Santarém / Ponta Negra',
        },
        {
          codigoItinerario: 'D',
          descricaolinha: 'O-33',
          descricaoItinerario: 'Planalto / Praia do Meio',
        },
      ].filter((r) => r.descricaolinha.includes(q)),
    );
    const service = new CatalogoRotasService({
      pesquisarRotas,
    } as unknown as NubusClient);
    const [linhas, rotas] = await Promise.all([
      service.linhas(),
      service.rotas(),
    ]);
    expect(linhas).toEqual([
      {
        numero: '33',
        descricoes: ['Planalto / Mãe Luiza', 'Planalto / Praia do Meio'],
      },
      { numero: '73', descricoes: ['Santarém / Ponta Negra'] },
    ]);
    expect(rotas).toHaveLength(4);
    await service.linhas();
    expect(pesquisarRotas).toHaveBeenCalledTimes(10);
  });

  it('retorna falha de origem para todos os pedidos e permite tentar novamente', async () => {
    const pesquisarRotas = vi
      .fn()
      .mockRejectedValue(new Error('Origem indisponível'));
    const service = new CatalogoRotasService({
      pesquisarRotas,
    } as unknown as NubusClient);
    const resultados = await Promise.allSettled([
      service.linhas(),
      service.rotas(),
    ]);
    for (const r of resultados) {
      expect(r.status).toBe('rejected');
      if (r.status === 'rejected')
        expect(r.reason).toBeInstanceOf(BadGatewayException);
    }
    pesquisarRotas.mockResolvedValue([]);
    expect(await service.linhas()).toEqual([]);
  });
});
