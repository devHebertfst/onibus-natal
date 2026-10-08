import { NubusClient } from './nubus.client.js';

describe('NubusClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('pede a previsão com descrição e prefixo da operadora', async () => {
    const fetch = vi.fn(async () => new Response('[]'));
    vi.stubGlobal('fetch', fetch);
    await new NubusClient().previsaoParada(
      'CDNO-33',
      'Planalto / Praia do Meio',
      'PARADA#1',
    );
    const [url, opcoes] = fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(new URL(url).searchParams.get('city')).toBe('ntl');
    expect(opcoes.headers).toMatchObject({ version: '2.3.34' });
    expect(JSON.parse(opcoes.body as string)).toEqual({
      cidade: 'ntl',
      sentido: '1',
      linha: 'CDNO-33',
      itinerario: 'Planalto / Praia do Meio',
      parada: 'CDNPARADA#1',
    });
  });
  it('usa GET com parâmetros e version no planejador', async () => {
    const fetch = vi.fn(async () => new Response('{"itineraries":[]}'));
    vi.stubGlobal('fetch', fetch);
    await new NubusClient().planejarTrajeto(
      -5.8,
      -35.2,
      -5.9,
      -35.3,
      '2026-10-08 08:00:00',
    );
    const [url, opcoes] = fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const params = new URL(url).searchParams;
    expect(params.get('datetime')).toBe('2026-10-08 08:00:00');
    expect(params.get('from_lat')).toBe('-5.8');
    expect(params.get('to_lng')).toBe('-35.3');
    expect(params.get('type')).toBe('departure');
    expect(opcoes.method).toBe('GET');
    expect(opcoes.body).toBeUndefined();
    expect(opcoes.headers).toMatchObject({ version: '2.3.34' });
  });
});
