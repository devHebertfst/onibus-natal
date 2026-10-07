import { NotFoundException } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { NubusClient } from '../nubus/nubus.client.js';
import type { NubusParadasEspecifica } from '../nubus/nubus.types.js';
import type { LinhaDto } from './linha.dto.js';
import { LinhasService, filtrarPorLinha } from './linhas.service.js';

function fakeClient(respostas: Record<string, NubusParadasEspecifica>) {
  return {
    pesquisarRotas: vi.fn(async (numero: string) =>
      numero === '33'
        ? [
            { codigoItinerario: 101, descricaoItinerario: '33 - IDA' },
            { codigoItinerario: 102, descricaoItinerario: '33 - VOLTA' },
          ]
        : [],
    ),
    paradasEspecifica: vi.fn(async (codigo: string) => respostas[codigo]),
  };
}

const respostas: Record<string, NubusParadasEspecifica> = {
  '101': {
    pontos: '-5.80 -35.20|-5.81 -35.21',
    paradas: [{ codigo: 1, Lat: -5.8, Long: -35.2, descricao: 'P1', ordem: 1 }],
    carros: [
      { carro: 'A1', Lat: -5.805, Long: -35.205 },
      { carro: 'B2', Lat: -5.809, Long: -35.209 },
    ],
  },
  '102': {
    pontos: '-5.81 -35.21|-5.80 -35.20',
    paradas: [],
    // B2 aparece nos dois itinerários
    carros: [{ carro: 'B2', Lat: -5.809, Long: -35.209 }],
  },
};

describe('LinhasService', () => {
  it('consolida itinerários e deduplica veículos', async () => {
    const client = fakeClient(respostas);
    const service = new LinhasService(client as unknown as NubusClient);

    const linha = await service.obter(' 33 ');

    expect(linha.numero).toBe('33');
    expect(linha.itinerarios).toHaveLength(2);
    expect(linha.itinerarios[0].tracado).toEqual([
      [-5.8, -35.2],
      [-5.81, -35.21],
    ]);
    expect(linha.onibus.map((o) => o.id)).toEqual(['A1', 'B2']);
    expect(linha.onibus[1].itinerarios).toEqual(['101', '102']);
    expect(service.acompanhadas()).toEqual(['33']);
  });

  it('serve do cache e consulta a API uma vez para vários clientes', async () => {
    const client = fakeClient(respostas);
    const service = new LinhasService(client as unknown as NubusClient);

    await Promise.all([
      service.obter('33'),
      service.obter('33'),
      service.obter('33'),
    ]);
    await service.obter('33');

    expect(client.pesquisarRotas).toHaveBeenCalledTimes(1);
    expect(client.paradasEspecifica).toHaveBeenCalledTimes(2); // 1x por itinerário
  });

  it('linha inexistente vira 404 e não fica sendo acompanhada', async () => {
    const service = new LinhasService(
      fakeClient(respostas) as unknown as NubusClient,
    );
    await expect(service.obter('999')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(service.acompanhadas()).toEqual([]);
  });

  it('mantém o último snapshot marcado como desatualizado se a API falhar', async () => {
    const client = fakeClient(respostas);
    const service = new LinhasService(client as unknown as NubusClient);
    vi.useFakeTimers();
    try {
      await service.obter('33');
      client.paradasEspecifica.mockRejectedValue(new Error('timeout'));
      vi.advanceTimersByTime(20_000);
      await service.atualizarTodas();

      const linha = await service.obter('33');
      expect(linha.desatualizado).toBe(true);
      expect(linha.onibus).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('observar empurra o snapshot atual e cada atualização do loop', async () => {
    const client = fakeClient(respostas);
    const service = new LinhasService(client as unknown as NubusClient);
    vi.useFakeTimers();
    try {
      const recebidos: LinhaDto[] = [];
      const sub = service.observar('33').subscribe((l) => recebidos.push(l));
      await vi.waitFor(() => expect(recebidos).toHaveLength(1));

      // Sem nenhum GET, o loop não descarta a linha enquanto há inscrito.
      vi.advanceTimersByTime(10 * 60_000);
      await service.atualizarTodas();
      expect(recebidos).toHaveLength(2);
      expect(service.acompanhadas()).toEqual(['33']);

      // Falha: um único aviso de desatualizado, não um por ciclo.
      client.paradasEspecifica.mockRejectedValue(new Error('timeout'));
      for (let i = 0; i < 2; i++) {
        vi.advanceTimersByTime(20_000);
        await service.atualizarTodas();
      }
      expect(recebidos).toHaveLength(3);
      expect(recebidos[2].desatualizado).toBe(true);

      sub.unsubscribe();
      vi.advanceTimersByTime(10 * 60_000);
      await service.atualizarTodas();
      expect(service.acompanhadas()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('observar propaga erro de linha inexistente', async () => {
    const service = new LinhasService(
      fakeClient(respostas) as unknown as NubusClient,
    );
    await expect(
      firstValueFrom(service.observar('999')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('filtra os itinerários pelo número exato da linha e remove repetidos', async () => {
    const brutos = [
      ['CDNO-33Planalto / Praia do Meio', 'O-33'],
      ['CDNO-33 ExtraPlanalto / Mae Luiza', 'O-33 Extra'],
      ['CMPO-33APlanalto / Midway', 'O-33A'],
      ['CMPO-33BPlanalto / Lagoa Seca', 'O-33B'],
      ['CMPO-33BPlanalto / Lagoa Seca', 'O-33B'],
      ['COM133Jardim Petrópolis / Natal', '133'],
    ].map(([codigoItinerario, descricaolinha]) => ({
      codigoItinerario,
      descricaoItinerario: codigoItinerario,
      descricaolinha,
    }));

    const doNumero = (n: string) =>
      filtrarPorLinha(brutos, n).map((b) => b.descricaolinha);
    expect(doNumero('33')).toEqual(['O-33', 'O-33 Extra']);
    expect(doNumero('33a')).toEqual(['O-33A']);
    expect(doNumero('133')).toEqual(['133']);

    const client = {
      pesquisarRotas: vi.fn(async () => brutos),
      paradasEspecifica: vi.fn(async () => ({})),
    };
    const service = new LinhasService(client as unknown as NubusClient);
    const linha = await service.obter('33B');
    expect(linha.itinerarios.map((i) => i.codigo)).toEqual([
      'CMPO-33BPlanalto / Lagoa Seca',
    ]);
  });
});
