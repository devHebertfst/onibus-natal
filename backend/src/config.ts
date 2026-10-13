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
  // Curto: quem fecha o app e volta logo ainda acha velocidade e sentido
  // prontos, mas a linha não fica consultando a API por meia hora à toa (o
  // ritmo de cada trecho já fica guardado no banco).
  linhaInativaMs: num(process.env.LINHA_INATIVA_MS, 5 * 60_000),

  /** Proteção da API de origem: máximo de linhas acompanhadas ao mesmo tempo. */
  maxLinhasAcompanhadas: num(process.env.MAX_LINHAS, 40),

  /**
   * Previsão de chegada numa parada: quem pedir a mesma parada nesse
   * intervalo recebe a mesma resposta, sem nova consulta à API.
   */
  previsaoTtlMs: num(process.env.PREVISAO_TTL_MS, 15_000),

  /**
   * A cada intervalo, pede a previsão no ponto final de cada sentido das
   * linhas acompanhadas: ela traz a hora real do GPS dos ônibus a caminho,
   * que calibra o atraso das posições. `AMOSTRA_GPS=false` desliga.
   */
  amostraGpsMs: num(process.env.AMOSTRA_GPS_MS, 60_000),
  amostrarGps: process.env.AMOSTRA_GPS !== 'false' && !process.env.VITEST,

  /**
   * Postgres (Neon) para o que vale guardar entre reinícios: índice de
   * paradas, catálogo de linhas e histórico de velocidade. Sem ele, tudo
   * fica só em memória e é remontado quando o servidor acorda.
   */
  databaseUrl: process.env.DATABASE_URL || undefined,

  /** Paradas da cidade e quais linhas passam em cada uma: muda pouco. */
  paradasTtlMs: num(process.env.PARADAS_TTL_MS, 24 * 60 * 60_000),

  /**
   * Monta o índice de paradas ao subir o servidor (~120 consultas), para o
   * primeiro "paradas perto de mim" não esperar. Desligado nos testes.
   */
  aquecerParadas:
    process.env.AQUECER_PARADAS !== 'false' && !process.env.VITEST,

  /** A lista de itinerários de uma linha quase nunca muda: cache longo. */
  itinerariosTtlMs: num(process.env.ITINERARIOS_TTL_MS, 6 * 60 * 60_000),

  velocidade: {
    /** Janela da média móvel de velocidade. */
    janelaMs: 90_000,
    /** Sem nova posição há mais que isso => parado (0 km/h). */
    paradoAposMs: 60_000,
    /** Deslocamentos menores que isso são ruído de GPS, não movimento. */
    ruidoMinimoM: 10,
    /** Posição com hora de GPS conhecida a menos disso é a mesma do histórico. */
    mesmaPosicaoM: 15,
    /** Saltos acima dessa velocidade são tratados como teletransporte/erro. */
    velocidadeMaximaKmh: 110,
    /** Esquece veículos que não aparecem há esse tempo. */
    esquecerAposMs: 10 * 60_000,
  },

  /**
   * Velocidade por trecho do traçado, aprendida com os próprios ônibus da
   * linha: cada par de posições consecutivas de um ônibus diz quanto tempo
   * ele levou para percorrer aquele pedaço, paradas e semáforos incluídos.
   */
  trechos: {
    /** Tamanho de cada trecho do traçado. */
    tamanhoM: 300,
    /** Posição mais longe que isso do traçado não conta (desvio, garagem). */
    distanciaMaxRotaM: 60,
    /** Entre duas posições mais espaçadas que isso, não dá para saber o que houve. */
    intervaloMaxMs: 5 * 60_000,
    /** Avanço maior que isso entre duas posições é salto, não percurso. */
    avancoMaxM: 2_000,
    /** Acima disso é erro de GPS ou de projeção. */
    velocidadeMaxKmh: 80,
    /** A cada meia-vida, uma observação pesa metade (o trânsito muda). */
    meiaVidaMs: 10 * 60_000,
    /** Trecho sem observação há mais que isso volta a ser desconhecido. */
    janelaMs: 30 * 60_000,
    /** Fração do trecho já percorrida (com o peso) para a velocidade valer. */
    coberturaMin: 0.5,
  },

  /**
   * Trânsito compartilhado entre linhas: quanto mais lento que o normal os
   * ônibus estão em cada pedaço de rua (~150 m, por sentido). Uma linha
   * aproveita o que as outras mediram nas ruas em comum.
   */
  transito: {
    /** Lado de cada pedaço de rua, em graus (~150 m). */
    celulaGraus: 0.00135,
    /** A cada meia-vida, uma medida pesa metade (o trânsito muda). */
    meiaVidaMs: 10 * 60_000,
    /** Pedaço sem medida há mais que isso volta a ser desconhecido. */
    janelaMs: 30 * 60_000,
    /** Metros medidos (com o peso) para o fator valer. */
    minimoM: 150,
    /** Limites do fator (lento/rápido em relação ao normal). */
    fatorMin: 0.25,
    fatorMax: 2,
  },

  /**
   * Coletor por amostras: em horários escolhidos, a cada 15 min, lê duas
   * vezes (com 1 min entre elas) as linhas troncais, só o bastante para
   * medir a velocidade, e para. Alimenta o histórico e o trânsito das
   * outras linhas sem deixar nada sendo consultado direto.
   * `COLETA=false` desliga; `COLETA_LINHAS` = "auto" (escolhe sozinho as
   * que mais cobrem ruas em comum) ou números separados por vírgula.
   */
  coleta: {
    ativa: process.env.COLETA !== 'false' && !process.env.VITEST,
    linhas: process.env.COLETA_LINHAS ?? 'auto',
    /** Quantas troncais no modo automático. */
    quantasAuto: num(process.env.COLETA_QUANTAS, 5),
    /** Faixas de horário de Natal, "início-fim" em horas (fim exclusivo). */
    horas: process.env.COLETA_HORAS ?? '6-9,16-19',
    intervaloMs: num(process.env.COLETA_INTERVALO_MS, 15 * 60_000),
    /** Entre as duas leituras de cada rajada (o GPS muda a cada ~30 s). */
    pausaMs: 60_000,
  },

  /**
   * Histórico da velocidade por trecho, por tipo de dia e faixa de horário,
   * no Postgres (`databaseUrl`).
   */
  historico: {
    /** O que foi medido vai para o banco em lote, a cada intervalo. */
    gravarMs: num(process.env.HISTORICO_GRAVAR_MS, 5 * 60_000),
    /** O histórico de um itinerário é relido do banco depois disso. */
    recarregarMs: 6 * 60 * 60_000,
    /** Depois de uma falha no banco, espera isso para tentar ler de novo. */
    esperaAposFalhaMs: 5 * 60_000,
    /** Tamanho de cada faixa de horário (minutos). */
    faixaMin: 30,
    /** A cada meia-vida, o que foi medido pesa metade (a cidade muda). */
    meiaVidaMs: 14 * 24 * 60 * 60_000,
    /** Fuso de Natal (UTC−3, sem horário de verão). */
    fusoMin: -180,
  },
};
