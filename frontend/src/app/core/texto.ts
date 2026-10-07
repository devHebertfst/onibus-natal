/** Palavras que ficam minúsculas no meio de um nome próprio. */
const MINUSCULAS = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'a',
  'o',
  'em',
  'na',
  'no',
  'via',
]);
/** Siglas que continuam maiúsculas. */
const SIGLAS = new Set(['UFRN', 'IFRN', 'BR', 'RN', 'CEFET', 'UPA', 'II', 'III', 'IV']);

/** "CIDADE NOVA / RIBEIRA" → "Cidade Nova / Ribeira" (só se o texto vier todo em maiúsculas). */
export function tituloPt(texto: string): string {
  const t = texto.trim();
  if (t !== t.toUpperCase()) return t;
  let primeira = true;
  return t.toLowerCase().replace(/[\p{L}\d]+/gu, (palavra) => {
    const maiuscula = palavra.toUpperCase();
    const inicio = primeira;
    primeira = false;
    if (SIGLAS.has(maiuscula)) return maiuscula;
    if (!inicio && MINUSCULAS.has(palavra)) return palavra;
    return palavra.charAt(0).toUpperCase() + palavra.slice(1);
  });
}

/**
 * Destino de um itinerário, como numa placa: "33 - CIDADE NOVA / RIBEIRA (IDA)"
 * → "Cidade Nova / Ribeira". Sem o número da linha nem o "(IDA)/(VOLTA)".
 */
export function destino(descricao: string): string {
  const semLinha = descricao.replace(/^\s*[\w-]+\s*[-–:]\s*/, '');
  const semSentido = semLinha.replace(/\s*\((ida|volta)\)\s*$/i, '');
  return tituloPt(semSentido || descricao) || descricao.trim();
}

/**
 * A API traz o endereço completo como nome da parada
 * ("Av. Eng. Roberto Freire, 1234 - Ponta Negra, Natal - RN, 59090-000, Brazil").
 * Para o passageiro bastam rua, número e bairro.
 */
export function nomeParada(descricao: string): string {
  const limpo = descricao
    .replace(/,?\s*(Brazil|Brasil)\s*$/i, '')
    .replace(/,?\s*\d{5}-?\d{3}/g, '')
    .replace(/,?\s*(State of Rio Grande do Norte|Rio Grande do Norte)\b/gi, '')
    .replace(/,?\s*Natal\s*(-\s*RN)?\s*$/i, '')
    .replace(/\s*-\s*RN\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s,–-]+$/, '')
    .trim();
  return tituloPt(limpo);
}

/** "350 m", "1,2 km". */
export function distanciaTexto(metros: number): string {
  // Espaço inquebrável: o número nunca fica numa linha e a unidade na outra.
  if (metros < 950) return `${Math.max(10, Math.round(metros / 10) * 10)}\u00a0m`;
  return `${(metros / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}\u00a0km`;
}
