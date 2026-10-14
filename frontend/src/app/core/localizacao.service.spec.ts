import { LocalizacaoService } from './localizacao.service';

/** GPS de mentira: guarda os callbacks para o teste empurrar posições. */
function gpsFalso() {
  const gps = {
    atual: null as null | ((p: GeolocationPosition) => void),
    assistindo: null as null | ((p: GeolocationPosition) => void),
    limpos: 0,
    getCurrentPosition(ok: (p: GeolocationPosition) => void) {
      gps.atual = ok;
    },
    watchPosition(ok: (p: GeolocationPosition) => void) {
      gps.assistindo = ok;
      return 7;
    },
    clearWatch() {
      gps.assistindo = null;
      gps.limpos++;
    },
  };
  Object.defineProperty(navigator, 'geolocation', { value: gps, configurable: true });
  return gps;
}

const em = (metrosNorte: number, precisao = 10) =>
  ({
    coords: { latitude: -5.8 + metrosNorte / 111_195, longitude: -35.2, accuracy: precisao },
  }) as GeolocationPosition;

function visibilidade(estado: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: estado, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('LocalizacaoService', () => {
  afterEach(() => visibilidade('visible'));

  it('depois de permitida, acompanha a posição em tempo real', async () => {
    const gps = gpsFalso();
    const local = new LocalizacaoService();
    const pedido = local.pedir();
    gps.atual!(em(0));
    expect(await pedido).toBeNull();
    expect(gps.assistindo).not.toBeNull(); // passou a acompanhar

    gps.assistindo!(em(30));
    expect(local.posicao()!.lat).toBeCloseTo(-5.8 + 30 / 111_195, 9);
  });

  it('ignora o tremor do GPS parado', async () => {
    const gps = gpsFalso();
    const local = new LocalizacaoService();
    const pedido = local.pedir();
    gps.atual!(em(0));
    await pedido;
    const antes = local.posicao();
    gps.assistindo!(em(1)); // 1 m: ruído
    expect(local.posicao()).toBe(antes);
    gps.assistindo!(em(1, 40)); // mas a precisão mudou bastante
    expect(local.posicao()).not.toBe(antes);
  });

  it('pausa em segundo plano e volta ao reabrir o app', async () => {
    const gps = gpsFalso();
    const local = new LocalizacaoService();
    const pedido = local.pedir();
    gps.atual!(em(0));
    await pedido;
    visibilidade('hidden');
    expect(gps.assistindo).toBeNull();
    expect(gps.limpos).toBeGreaterThan(0);
    visibilidade('visible');
    expect(gps.assistindo).not.toBeNull();
  });

  it('acompanhando e com posição fresca, o "onde estou" responde na hora', async () => {
    const gps = gpsFalso();
    const local = new LocalizacaoService();
    const pedido = local.pedir();
    gps.atual!(em(0));
    await pedido;
    gps.atual = null;
    expect(await local.pedir()).toBeNull();
    expect(gps.atual).toBeNull(); // não pediu de novo ao GPS
  });
});
