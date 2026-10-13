import { Logger } from '@nestjs/common';
import pg from 'pg';
import { config } from '../config.js';

/**
 * O que os armazéns pedem do banco: `query(sql, params)`. Serve o `Pool` do
 * `pg` e, nos testes, o PGlite (Postgres em memória).
 */
export interface Consulta {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

export const BANCO = Symbol('BANCO');

let pool: pg.Pool | null | undefined;

/**
 * Conexão com o Postgres (Neon) compartilhada pelo app inteiro, ou `null`
 * sem `DATABASE_URL`. Criada na 1ª vez que alguém pede.
 */
export function bancoCompartilhado(url = config.databaseUrl): Consulta | null {
  if (pool !== undefined) return pool;
  if (!url) return (pool = null);
  pool = new pg.Pool({
    // O Neon entrega a URL com sslmode=require, que o `pg` já trata como
    // verify-full (com um aviso enorme no log); dizer isso explicitamente
    // mantém a mesma segurança sem o aviso.
    connectionString: url.replace(/sslmode=require\b/, 'sslmode=verify-full'),
    max: 3,
    // O Neon derruba conexões ociosas: melhor fechar antes.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // Sem isso, uma conexão ociosa derrubada pelo servidor derruba o processo.
  pool.on('error', (e) =>
    new Logger('Banco').warn(`Conexão com o banco caiu: ${e.message}`),
  );
  return pool;
}
