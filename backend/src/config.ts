/**
 * Configuração central do backend. Tudo pode ser sobrescrito por variável de
 * ambiente, o que facilita apontar para um servidor fake em testes locais.
 */
const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  port: num(process.env.PORT, 3000),

  /** API pública de transporte (Nubus). */
  nubus: {
    baseUrl:
      process.env.NUBUS_BASE_URL ??
      'https://api-prod-vpc.appnubus.com.br/api/v1',
    version: process.env.NUBUS_VERSION ?? '2.3.34',
    cidade: process.env.NUBUS_CIDADE ?? 'ntl',
    timeoutMs: num(process.env.NUBUS_TIMEOUT_MS, 10_000),
  },

  /** Intervalo do loop de atualização das linhas acompanhadas. */
  pollIntervalMs: num(process.env.POLL_INTERVAL_MS, 15_000),

  /** Comentário periódico no stream SSE para proxies não derrubarem a conexão. */
  ssePingMs: num(process.env.SSE_PING_MS, 20_000),

  /** Uma linha deixa de ser acompanhada se ninguém a pedir por esse tempo. */
  linhaInativaMs: num(process.env.LINHA_INATIVA_MS, 5 * 60_000),

  /** Proteção da API de origem: máximo de linhas acompanhadas ao mesmo tempo. */
  maxLinhasAcompanhadas: num(process.env.MAX_LINHAS, 40),

  /** A lista de itinerários de uma linha quase nunca muda: cache longo. */
  itinerariosTtlMs: num(process.env.ITINERARIOS_TTL_MS, 6 * 60 * 60_000),

  velocidade: {
    /** Janela da média móvel de velocidade. */
    janelaMs: 90_000,
    /** Sem nova posição há mais que isso => parado (0 km/h). */
    paradoAposMs: 60_000,
    /** Deslocamentos menores que isso são ruído de GPS, não movimento. */
    ruidoMinimoM: 10,
    /** Saltos acima dessa velocidade são tratados como teletransporte/erro. */
    velocidadeMaximaKmh: 110,
    /** Esquece veículos que não aparecem há esse tempo. */
    esquecerAposMs: 10 * 60_000,
  },
};
