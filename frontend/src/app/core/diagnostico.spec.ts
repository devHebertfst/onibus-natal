import { Diagnostico } from './diagnostico';

describe('Diagnostico', () => {
  it('resume o erro do desenho em metros, segundos e quanto fica atrás', () => {
    const d = new Diagnostico();
    for (const m of [-60, -40, -20, 10]) d.registrarDesenho(m, 10);
    expect(d.resumo().desenho).toEqual({ amostras: 4, medianaM: -30, medianaS: -3, atrasPct: 75 });
  });

  it('compara com a Nubus no máximo uma vez a cada 30 s por ônibus', () => {
    const d = new Diagnostico();
    d.registrarComparacao('A', 6, 4, 0);
    d.registrarComparacao('A', 9, 4, 10_000); // cedo demais: ignorada
    d.registrarComparacao('A', 3, 4, 40_000);
    expect(d.resumo().comparacao).toEqual({ amostras: 2, medianaMin: 0.5, mediaAbsMin: 1.5 });
  });
});
