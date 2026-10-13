/**
 * Feriados em Natal: nesses dias o trânsito e a tabela dos ônibus são de
 * domingo, e o histórico de dia útil faria o feriado parecer horário de pico.
 *
 * Nacionais, os do RN e os municipais de Natal. Datas a mais (ponto
 * facultativo, feriado novo) entram por `FERIADOS_EXTRA`, separadas por
 * vírgula: "MM-DD" (todo ano) ou "AAAA-MM-DD".
 */
const FIXOS = [
  '01-01', // Confraternização Universal
  '01-06', // Santos Reis (Natal)
  '04-21', // Tiradentes
  '05-01', // Dia do Trabalho
  '09-07', // Independência
  '10-03', // Mártires de Cunhaú e Uruaçu (RN)
  '10-12', // Nossa Senhora Aparecida
  '11-02', // Finados
  '11-15', // Proclamação da República
  '11-20', // Consciência Negra
  '11-21', // Nossa Senhora da Apresentação (Natal)
  '12-25', // Natal
];

/** Dias depois (ou antes) da Páscoa: Carnaval, Sexta-feira Santa, Corpus Christi. */
const MOVEIS = [-48, -47, -2, 60];

const extras = (process.env.FERIADOS_EXTRA ?? '')
  .split(',')
  .map((d) => d.trim())
  .filter((d) => /^(\d{4}-)?\d{2}-\d{2}$/.test(d));

const doAno = new Map<number, Set<string>>();

/** `data` em "AAAA-MM-DD" (horário de Natal) é feriado? */
export function ehFeriado(data: string): boolean {
  const ano = Number(data.slice(0, 4));
  let dias = doAno.get(ano);
  if (!dias) {
    const pascoa = domingoDePascoa(ano);
    dias = new Set([
      ...FIXOS.map((d) => `${ano}-${d}`),
      ...MOVEIS.map((n) =>
        new Date(pascoa + n * 86_400_000).toISOString().slice(0, 10),
      ),
      ...extras.map((d) => (d.length === 5 ? `${ano}-${d}` : d)),
    ]);
    doAno.set(ano, dias);
  }
  return dias.has(data);
}

/** Domingo de Páscoa (meia-noite UTC), pelo algoritmo de Meeus/Jones/Butcher. */
export function domingoDePascoa(ano: number): number {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(ano, mes - 1, dia);
}
