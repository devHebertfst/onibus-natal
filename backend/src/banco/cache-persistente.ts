import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { gunzipSync, gzipSync } from 'node:zlib';
import { BANCO, bancoCompartilhado, type Consulta } from './banco.js';

const CRIAR_TABELA = `
  CREATE TABLE IF NOT EXISTS cache_persistente (
    chave text PRIMARY KEY,
    valor bytea NOT NULL,
    salvo_em timestamptz NOT NULL DEFAULT now()
  )`;

/**
 * Guarda no banco o que é caro de montar e muda pouco (índice de paradas,
 * catálogo de linhas), para o servidor não refazer tudo na API de origem a
 * cada vez que acorda. JSON compactado (gzip), uma linha por chave.
 *
 * Falhas do banco nunca derrubam nada: ler devolve `undefined` e gravar só
 * avisa no log.
 */
@Injectable()
export class CachePersistente {
  private readonly logger = new Logger(CachePersistente.name);
  private readonly db: Consulta | null;
  private tabela?: Promise<void>;

  constructor(@Optional() @Inject(BANCO) db?: Consulta | null) {
    this.db = db === undefined ? bancoCompartilhado() : db;
  }

  get ativo(): boolean {
    return this.db !== null;
  }

  async ler<T>(chave: string): Promise<T | undefined> {
    if (!this.db) return undefined;
    try {
      await this.criarTabela();
      const { rows } = await this.db.query(
        'SELECT valor FROM cache_persistente WHERE chave = $1',
        [chave],
      );
      if (rows.length === 0) return undefined;
      const bruto = rows[0].valor as Uint8Array;
      return JSON.parse(gunzipSync(bruto).toString('utf8')) as T;
    } catch (e) {
      this.logger.warn(`Falha ao ler "${chave}": ${(e as Error).message}`);
      return undefined;
    }
  }

  async gravar(chave: string, valor: unknown): Promise<void> {
    if (!this.db) return;
    try {
      await this.criarTabela();
      await this.db.query(
        `INSERT INTO cache_persistente (chave, valor) VALUES ($1, $2)
         ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, salvo_em = now()`,
        [chave, gzipSync(JSON.stringify(valor))],
      );
    } catch (e) {
      this.logger.warn(`Falha ao gravar "${chave}": ${(e as Error).message}`);
    }
  }

  private criarTabela(): Promise<void> {
    this.tabela ??= this.db!.query(CRIAR_TABELA).then(
      () => undefined,
      (e: unknown) => {
        this.tabela = undefined; // tenta de novo na próxima
        throw e;
      },
    );
    return this.tabela;
  }
}
