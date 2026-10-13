import { domingoDePascoa, ehFeriado } from './feriados.js';
import { horarioLocal } from './historico-trechos.js';

describe('feriados', () => {
  it('calcula a Páscoa e os feriados que dependem dela', () => {
    const dia = (t: number) => new Date(t).toISOString().slice(0, 10);
    expect(dia(domingoDePascoa(2026))).toBe('2026-04-05');
    expect(dia(domingoDePascoa(2027))).toBe('2027-03-28');
    expect(ehFeriado('2026-02-16')).toBe(true); // segunda de Carnaval
    expect(ehFeriado('2026-02-17')).toBe(true); // terça de Carnaval
    expect(ehFeriado('2026-04-03')).toBe(true); // Sexta-feira Santa
    expect(ehFeriado('2026-06-04')).toBe(true); // Corpus Christi
  });

  it('inclui os fixos nacionais, do RN e de Natal', () => {
    for (const d of ['01-01', '01-06', '10-03', '11-20', '11-21', '12-25'])
      expect(ehFeriado(`2026-${d}`)).toBe(true);
    expect(ehFeriado('2026-10-13')).toBe(false);
  });

  it('no histórico, feriado em dia de semana conta como domingo', () => {
    // sexta, 20/11/2026, 08:00 em Natal
    expect(horarioLocal(Date.parse('2026-11-20T11:00:00Z')).tipoDia).toBe(2);
    // a sexta seguinte é dia útil
    expect(horarioLocal(Date.parse('2026-11-27T11:00:00Z')).tipoDia).toBe(0);
  });
});
