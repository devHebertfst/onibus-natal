import { config } from '../config.js';
import type { NubusClient } from '../nubus/nubus.client.js';
import type { ParadasService } from '../paradas/paradas.service.js';
import type { ItinerarioMalha } from '../trajetos/roteador.js';
import {
  ColetorTroncais,
  dentroDasFaixas,
  escolherTroncais,
  lerFaixas,
} from './coletor.js';
import { LinhasService } from './linhas.service.js';

const M = 1 / 111_195;
/** Avenida de `metros` rumo ao norte, começando em `inicio` m. */
const avenida = (inicio: number, metros: number, lng = -35.2) =>
  Array.from({ length: metros / 100 + 1 }, (_, i) => ({
    lat: -5.8 + (inicio + i * 100) * M,
    lng,
  }));
const itinerario = (
  numero: string,
  tracado: { lat: number; lng: number }[],
): ItinerarioMalha => ({
  numero,
  codigo: numero,
  descricao: '',
  codigolinha: '',
  paradas: [],
  tracado,
});

/** 07:00 de uma sexta em Natal (10:00 UTC). */
const SETE_DA_MANHA = Date.parse('2026-10-09T10:00:00Z');
const MIN = 60_000;

describe('escolherTroncais', () => {
  it('escolhe a que mais cobre ruas em comum e não escolhe quem não acrescenta', () => {
    const malha = [
      itinerario('A', avenida(0, 2000)), // a avenida inteira
      itinerario('B', avenida(0, 800)), // começo da avenida
      itinerario('C', avenida(1200, 800)), // fim da avenida
      itinerario('D', avenida(0, 2000, -35.25)), // sozinha, longe
    ];
    expect(escolherTroncais(malha, 3)).toEqual(['A']);
    expect(escolherTroncais(malha.slice(1), 3)).toEqual([]);
    // A fora da disputa: B e C passam a valer (as ruas de A ainda contam)
    expect(escolherTroncais(malha, 3, new Set(['A']))).toEqual(['B', 'C']);
  });
});

describe('faixas de horário', () => {
  it('lê "6-9,16-19" no horário de Natal', () => {
    const faixas = lerFaixas('6-9, 16-19, lixo, 9-6');
    expect(faixas).toEqual([
      [6, 9],
      [16, 19],
    ]);
    expect(dentroDasFaixas(SETE_DA_MANHA, faixas)).toBe(true);
    expect(dentroDasFaixas(SETE_DA_MANHA + 2 * 60 * MIN, faixas)).toBe(false); // 9h
    expect(dentroDasFaixas(SETE_DA_MANHA + 10 * 60 * MIN, faixas)).toBe(true); // 17h
  });
});

describe('ColetorTroncais', () => {
  /** Duas avenidas: A e B dividem uma; C e D, a outra. */
  const malha = [
    itinerario('A', avenida(0, 2000)),
    itinerario('B', avenida(0, 1000)),
    itinerario('C', avenida(0, 2000, -35.25)),
    itinerario('D', avenida(0, 800, -35.25)),
  ];
  /** `rende`: quantas medidas cada leitura da linha dá (padrão: 3). */
  const novo = (linhas = 'auto', rende: Record<string, number> = {}) => {
    const lidas: string[] = [];
    const coletor = new ColetorTroncais(
      {
        coletar: vi.fn(async (n: string) => {
          lidas.push(n);
          return rende[n] ?? 3;
        }),
      } as unknown as LinhasService,
      { malha: async () => malha } as unknown as ParadasService,
      {
        ...config.coleta,
        ativa: true,
        linhas,
        quantasAuto: 1,
        horas: '6-9',
        pausaMs: 0,
      },
    );
    return { coletor, lidas };
  };

  it('lê cada troncal duas vezes por rajada, a cada 15 min, só no horário', async () => {
    const { coletor, lidas } = novo();
    await coletor.tique(SETE_DA_MANHA);
    expect(lidas).toEqual(['A', 'A']);
    await coletor.tique(SETE_DA_MANHA + 5 * MIN); // cedo demais
    expect(lidas).toHaveLength(2);
    await coletor.tique(SETE_DA_MANHA + 15 * MIN);
    expect(lidas).toHaveLength(4);
    await coletor.tique(SETE_DA_MANHA + 5 * 60 * MIN); // meio-dia
    expect(lidas).toHaveLength(4);
    expect(coletor.resumo()).toMatchObject({ linhas: ['A'], rajadas: 2 });
  });

  it('troca a troncal que passa 2 rajadas sem ônibus andando', async () => {
    const { coletor, lidas } = novo('auto', { A: 0 });
    await coletor.tique(SETE_DA_MANHA);
    expect(coletor.resumo().linhas).toEqual(['A']); // 1 rajada vazia: espera
    await coletor.tique(SETE_DA_MANHA + 15 * MIN);
    const r = coletor.resumo();
    expect(r.descartadas).toEqual(['A']);
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas).not.toContain('A');
    // a próxima rajada já lê a substituta
    lidas.length = 0;
    await coletor.tique(SETE_DA_MANHA + 30 * MIN);
    expect(lidas).toEqual([r.linhas![0], r.linhas![0]]);
  });

  it('não troca linha que alguém está acompanhando nem linhas da configuração', async () => {
    const aberta = novo('auto', {});
    // coletar devolve null: a linha está aberta no ciclo normal
    (
      aberta.coletor as unknown as { linhas: { coletar: () => unknown } }
    ).linhas.coletar = async () => null;
    await aberta.coletor.tique(SETE_DA_MANHA);
    await aberta.coletor.tique(SETE_DA_MANHA + 15 * MIN);
    expect(aberta.coletor.resumo().descartadas).toEqual([]);

    const fixas = novo('33', { '33': 0 });
    await fixas.coletor.tique(SETE_DA_MANHA);
    await fixas.coletor.tique(SETE_DA_MANHA + 15 * MIN);
    expect(fixas.coletor.resumo()).toMatchObject({
      linhas: ['33'],
      descartadas: [],
    });
  });

  it('usa a lista da configuração quando não é "auto"', async () => {
    const { coletor, lidas } = novo('33, 85');
    await coletor.tique(SETE_DA_MANHA);
    expect(lidas.sort()).toEqual(['33', '33', '85', '85']);
  });
});

describe('LinhasService.coletar', () => {
  const pontos = avenida(0, 2000)
    .map((p) => `${p.lat} ${p.lng}`)
    .join('|');
  let posicaoM = 0;
  const client = {
    pesquisarRotas: vi.fn(async () => [
      {
        codigoItinerario: 101,
        descricaoItinerario: '33 - IDA',
        descricaolinha: 'O-33',
        codigolinha: 'CDNO-33',
      },
    ]),
    paradasEspecifica: vi.fn(async () => ({
      pontos,
      paradas: [],
      carros: [{ carro: 'X', Lat: -5.8 + posicaoM * M, Long: -35.2 }],
    })),
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(SETE_DA_MANHA);
    posicaoM = 0;
    client.paradasEspecifica.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('mede a velocidade com duas leituras, fora do ciclo normal', async () => {
    const service = new LinhasService(client as unknown as NubusClient);
    expect(await service.coletar('33')).toBe(0); // 1ª leitura: nada a medir
    vi.setSystemTime(SETE_DA_MANHA + MIN);
    posicaoM = 300;
    expect(await service.coletar('33')).toBe(1); // um percurso medido

    // 300 m em 60 s, medido na hora (sem esperar a posição seguinte)
    expect(service.resumoTrechos()).toEqual([
      expect.objectContaining({ linha: '33', mediaKmh: 18 }),
    ]);
    // fora da amostragem de GPS e do ciclo de 15 s
    expect(service.prontas()).toEqual([]);
    const chamadas = client.paradasEspecifica.mock.calls.length;
    await service.atualizarTodas();
    expect(client.paradasEspecifica).toHaveBeenCalledTimes(chamadas);
  });

  it('quando alguém abre a linha, ela entra no ciclo normal com dados frescos', async () => {
    const service = new LinhasService(client as unknown as NubusClient);
    await service.coletar('33');
    const chamadas = client.paradasEspecifica.mock.calls.length;
    vi.setSystemTime(SETE_DA_MANHA + 10 * MIN);
    const linha = await service.obter('33');
    expect(client.paradasEspecifica.mock.calls.length).toBe(chamadas + 1);
    expect(Date.parse(linha.atualizadoEm)).toBe(SETE_DA_MANHA + 10 * MIN);
    expect(service.prontas()).toHaveLength(1);
    // e o coletor não a lê mais por cima do ciclo normal
    await service.coletar('33');
    expect(client.paradasEspecifica.mock.calls.length).toBe(chamadas + 1);
  });
});
