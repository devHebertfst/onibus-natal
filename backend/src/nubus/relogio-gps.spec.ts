import { config } from '../config.js';
import { RelogioGps } from './relogio-gps.js';

const previsao = (carro: string, gps: string, extra = {}) => ({
  Carro: carro,
  tipo: 'On-line',
  latitude: '-5.8',
  longitude: '-35.2',
  gpsVeiculoData: gps,
  ...extra,
});

describe('RelogioGps', () => {
  const agora = Date.parse('2026-10-07T19:34:00-03:00');

  it('guarda a hora do GPS dos ônibus ao vivo', () => {
    const r = new RelogioGps();
    r.registrarPrevisoes(
      [
        previsao('CDN1', '2026-10-07T19:33:40-03:00'),
        previsao('CDN2', '2026-10-07T19:33:40-03:00', { tipo: 'Off-line' }),
        previsao('CDN3', '2026-10-07T21:00:00-03:00'), // no futuro: relógio errado
      ],
      agora,
    );
    expect(r.ultimoDe('CDN1')?.gpsEm).toBe(agora - 20_000);
    expect(r.ultimoDe('CDN2')).toBeUndefined();
    expect(r.ultimoDe('CDN3')).toBeUndefined();
  });

  it('sem amostras, desconta meio intervalo de poll; com amostras, a mediana', () => {
    const r = new RelogioGps();
    expect(r.atrasoEstimadoMs()).toBe(config.pollIntervalMs / 2);
    for (const s of [18, 20, 22, 25, 40]) r.registrarAtraso(s * 1000);
    expect(r.atrasoEstimadoMs()).toBe(22_000);
    r.registrarAtraso(-1); // inválido
    r.registrarAtraso(10 * 60_000); // longo demais
    expect(r.resumo()).toMatchObject({
      amostras: 5,
      medianaS: 22,
      aplicadoS: 22,
    });
  });
});
