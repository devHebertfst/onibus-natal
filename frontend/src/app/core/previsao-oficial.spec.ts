import { Previsao } from '../mapa/dead-reckoning/previsao';
import { Chegada } from './linha.models';
import { VALIDADE_OFICIAL_MS, horaLocal, mesclarPrevisoes } from './previsao-oficial';

const AGORA = Date.parse('2026-10-07T22:30:00Z');
const emMin = (min: number) => new Date(AGORA + min * 60_000).toISOString();

const aoVivo = (onibus: string, min: number, metros = 1000): Chegada => ({
  onibus,
  aoVivo: true,
  chegaEm: emMin(min),
  metros,
  gpsEm: emMin(-0.5),
});
const tabela = (min: number): Chegada => ({
  onibus: null,
  aoVivo: false,
  chegaEm: emMin(min),
  metros: null,
  gpsEm: null,
});

const local: Previsao[] = [
  { onibus: 'A', metros: 900, minutos: 3, paradas: 2 },
  { onibus: 'B', metros: 5000, minutos: 16, paradas: 9 },
];

describe('mesclarPrevisoes', () => {
  it('mantém distância desconhecida quando só a Nubus vê o ônibus', () => {
    const chegada = { ...aoVivo('C', 5), metros: null };
    const r = mesclarPrevisoes([], { chegadas: [chegada], recebidoEm: AGORA }, AGORA);
    expect(r.previsoes[0].metros).toBeNull();
    expect(r.previsoes[0].paradas).toBeNull();
  });
  it('sem a Nubus, fica a estimativa própria', () => {
    expect(mesclarPrevisoes(local, null, AGORA)).toEqual({
      previsoes: local,
      fonte: 'estimativa',
      tabela: null,
    });
  });

  it('com a Nubus velha demais, também', () => {
    const oficial = { chegadas: [aoVivo('A', 5)], recebidoEm: AGORA - VALIDADE_OFICIAL_MS - 1 };
    expect(mesclarPrevisoes(local, oficial, AGORA).fonte).toBe('estimativa');
  });

  it('a Nubus decide quais ônibus vêm e o tempo; a conta própria dá as paradas', () => {
    const oficial = {
      chegadas: [aoVivo('C', 9, 3000), aoVivo('A', 5, 1200), tabela(40)],
      recebidoEm: AGORA,
    };
    const r = mesclarPrevisoes(local, oficial, AGORA);
    expect(r.fonte).toBe('nubus');
    expect(r.tabela).toBeNull(); // há ônibus ao vivo
    expect(r.previsoes).toEqual([
      { onibus: 'A', metros: 900, minutos: 5, paradas: 2 },
      // Só a Nubus vê o C (sentido ainda desconhecido aqui): sem contagem de paradas.
      { onibus: 'C', metros: 3000, minutos: 9, paradas: null },
    ]);
  });

  it('conta os minutos a partir do horário previsto, e segura o atrasado por 2 min', () => {
    const oficial = {
      chegadas: [aoVivo('A', -1), aoVivo('B', -3), aoVivo('C', 2)],
      recebidoEm: AGORA - 30_000,
    };
    const r = mesclarPrevisoes([], oficial, AGORA);
    expect(r.previsoes.map((p) => [p.onibus, p.minutos])).toEqual([
      ['A', 0],
      ['C', 2],
    ]);
  });

  it('sem ônibus ao vivo, mostra a próxima viagem da tabela', () => {
    const oficial = { chegadas: [tabela(-5), tabela(25), tabela(60)], recebidoEm: AGORA };
    const r = mesclarPrevisoes(local, oficial, AGORA);
    expect(r.previsoes).toEqual([]);
    expect(r.tabela).toBe(horaLocal(AGORA + 25 * 60_000));
  });
});

describe('horaLocal', () => {
  it('usa o fuso de Natal', () => {
    expect(horaLocal(Date.parse('2026-10-07T22:55:00Z'))).toBe('19:55');
  });
});
