/**
 * Onde o histórico da velocidade por trecho fica guardado: uma tabela no
 * Postgres (Neon em produção). Recebe qualquer coisa com `query(sql, params)`
 * — o `Pool` do `pg` ou, nos testes, o PGlite (Postgres em memória).
 */
export interface Consulta {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

/** Percurso medido num trecho, num tipo de dia e faixa de horário. */
export interface RegistroTrecho {
  itinerario: string;
  /** Identifica o traçado: se ele mudar, o histórico antigo não vale mais. */
  assinatura: string;
  /** 0 = dia útil, 1 = sábado, 2 = domingo. */
  tipoDia: number;
  /** Faixa de horário do dia (0 = 00:00–00:30, com faixas de 30 min). */
  faixa: number;
  trecho: number;
  metros: number;
  segundos: number;
}

const CRIAR_TABELA = `
  CREATE TABLE IF NOT EXISTS velocidade_trecho (
    itinerario text NOT NULL,
    assinatura text NOT NULL,
    tipo_dia smallint NOT NULL,
    faixa smallint NOT NULL,
    trecho smallint NOT NULL,
    metros double precision NOT NULL,
    segundos double precision NOT NULL,
    atualizado_em timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (itinerario, tipo_dia, faixa, trecho)
  )`;

/** O que já estava no banco perde peso com o tempo (meia-vida, em segundos: $8). */
const DECAIMENTO = `power(0.5, extract(epoch FROM now() - velocidade_trecho.atualizado_em) / $8)`;

const GRAVAR = `
  INSERT INTO velocidade_trecho
    (itinerario, assinatura, tipo_dia, faixa, trecho, metros, segundos)
  SELECT * FROM unnest(
    $1::text[], $2::text[], $3::smallint[], $4::smallint[], $5::smallint[],
    $6::double precision[], $7::double precision[])
  ON CONFLICT (itinerario, tipo_dia, faixa, trecho) DO UPDATE SET
    metros = CASE WHEN velocidade_trecho.assinatura = EXCLUDED.assinatura
      THEN velocidade_trecho.metros * ${DECAIMENTO} + EXCLUDED.metros
      ELSE EXCLUDED.metros END,
    segundos = CASE WHEN velocidade_trecho.assinatura = EXCLUDED.assinatura
      THEN velocidade_trecho.segundos * ${DECAIMENTO} + EXCLUDED.segundos
      ELSE EXCLUDED.segundos END,
    assinatura = EXCLUDED.assinatura,
    atualizado_em = now()`;

const CARREGAR = `
  SELECT faixa, trecho,
    metros * power(0.5, extract(epoch FROM now() - atualizado_em) / $4) AS metros,
    segundos * power(0.5, extract(epoch FROM now() - atualizado_em) / $4) AS segundos
  FROM velocidade_trecho
  WHERE itinerario = $1 AND assinatura = $2 AND tipo_dia = $3`;

export class ArmazemTrechos {
  private tabela?: Promise<void>;

  constructor(
    private readonly db: Consulta,
    private readonly meiaVidaMs: number,
    private readonly encerrarConexao: () => Promise<void> = async () => {},
  ) {}

  /** Soma os registros ao que já existe (com o decaimento) num só comando. */
  async gravar(registros: RegistroTrecho[]): Promise<void> {
    if (registros.length === 0) return;
    await this.criarTabela();
    const coluna = <K extends keyof RegistroTrecho>(k: K) =>
      registros.map((r) => r[k]);
    await this.db.query(GRAVAR, [
      coluna('itinerario'),
      coluna('assinatura'),
      coluna('tipoDia'),
      coluna('faixa'),
      coluna('trecho'),
      coluna('metros'),
      coluna('segundos'),
      this.meiaVidaMs / 1000,
    ]);
  }

  /** Histórico do itinerário (com este traçado) no tipo de dia, já com o decaimento. */
  async carregar(
    itinerario: string,
    assinatura: string,
    tipoDia: number,
  ): Promise<
    { faixa: number; trecho: number; metros: number; segundos: number }[]
  > {
    await this.criarTabela();
    const { rows } = await this.db.query(CARREGAR, [
      itinerario,
      assinatura,
      tipoDia,
      this.meiaVidaMs / 1000,
    ]);
    return rows.map((r) => ({
      faixa: Number(r.faixa),
      trecho: Number(r.trecho),
      metros: Number(r.metros),
      segundos: Number(r.segundos),
    }));
  }

  encerrar(): Promise<void> {
    return this.encerrarConexao();
  }

  private criarTabela(): Promise<void> {
    this.tabela ??= this.db.query(CRIAR_TABELA).then(
      () => undefined,
      (e: unknown) => {
        this.tabela = undefined; // tenta de novo na próxima
        throw e;
      },
    );
    return this.tabela;
  }
}
