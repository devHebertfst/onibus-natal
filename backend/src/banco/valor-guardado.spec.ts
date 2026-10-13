import { PGlite } from '@electric-sql/pglite';
import type { Consulta } from './banco.js';
import { CachePersistente } from './cache-persistente.js';
import { ValorGuardado } from './valor-guardado.js';

const HORA = 60 * 60_000;

// Um Postgres em memória para o arquivo todo (subir um leva ~1 s).
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.waitReady;
}, 30_000);
afterAll(() => db.close());

async function cacheLimpo() {
  await db.query('DROP TABLE IF EXISTS cache_persistente');
  return new CachePersistente(db as Consulta);
}

/** Espera as gravações e montagens em segundo plano terminarem. */
const respirar = () => new Promise((r) => setTimeout(r, 50));

describe('CachePersistente', () => {
  it('guarda e devolve o valor (compactado), e substitui o anterior', async () => {
    const cache = await cacheLimpo();
    expect(await cache.ler('x')).toBeUndefined();
    await cache.gravar('x', { a: [1, 2, 3], b: 'ç' });
    expect(await cache.ler('x')).toEqual({ a: [1, 2, 3], b: 'ç' });
    await cache.gravar('x', 'novo');
    expect(await cache.ler('x')).toBe('novo');
    const { rows } = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM cache_persistente',
    );
    expect(rows[0].n).toBe(1);
  });

  it('com o banco fora do ar, não falha: só não guarda', async () => {
    const cache = new CachePersistente({
      query: () => Promise.reject(new Error('fora do ar')),
    });
    await expect(cache.gravar('x', 1)).resolves.toBeUndefined();
    await expect(cache.ler('x')).resolves.toBeUndefined();
    expect(new CachePersistente(null).ativo).toBe(false);
  });
});

describe('ValorGuardado', () => {
  const novo = (cache: CachePersistente, montar: () => Promise<string>) =>
    new ValorGuardado<string>(cache, {
      chave: 'teste',
      validadeMs: HORA,
      montar,
      esperaAposFalhaMs: 10 * 60_000,
    });

  it('ao reiniciar, lê do banco em vez de montar de novo', async () => {
    const cache = await cacheLimpo();
    const montar = vi.fn(async () => 'índice');
    expect(await novo(cache, montar).obter()).toBe('índice');
    await respirar();

    // servidor acordou: memória vazia, banco com o valor
    const montarDeNovo = vi.fn(async () => 'outro');
    const depois = novo(cache, montarDeNovo);
    expect(await depois.obter()).toBe('índice');
    expect(montarDeNovo).not.toHaveBeenCalled();
    expect(montar).toHaveBeenCalledTimes(1);
  });

  it('vencido, serve o anterior na hora e atualiza por trás', async () => {
    const cache = await cacheLimpo();
    const v = novo(cache, async () => 'v1');
    await v.obter();
    const montadoEm = v.montadoEm!;

    let resolver!: (s: string) => void;
    const montar = vi.fn(
      () => new Promise<string>((r) => (resolver = r)), // demora
    );
    const vencido = novo(cache, montar);
    // mesmo vencido, responde na hora com o antigo
    expect(await vencido.obter(montadoEm + 2 * HORA)).toBe('v1');
    expect(await vencido.obter(montadoEm + 2 * HORA)).toBe('v1');
    expect(montar).toHaveBeenCalledTimes(1); // uma remontagem só
    resolver('v2');
    await respirar();
    expect(await vencido.obter()).toBe('v2');
    expect(await cache.ler('teste')).toMatchObject({ valor: 'v2' });
  });

  it('se a atualização falhar, segue com o anterior e espera antes de tentar de novo', async () => {
    const cache = await cacheLimpo();
    const v = novo(cache, async () => 'v1');
    await v.obter();
    const depois = v.montadoEm! + 2 * HORA;

    const montar = vi.fn(async () => {
      throw new Error('API fora do ar');
    });
    const vencido = novo(cache, montar);
    expect(await vencido.obter(depois)).toBe('v1');
    await respirar();
    expect(await vencido.obter(depois)).toBe('v1');
    expect(montar).toHaveBeenCalledTimes(1);
  });

  it('sem valor nenhum, quem pede espera a montagem, e uma falha pode ser tentada de novo', async () => {
    const cache = await cacheLimpo();
    const montar = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('falhou'))
      .mockResolvedValue('ok');
    const v = novo(cache, montar);
    await expect(v.obter()).rejects.toThrow('falhou');
    expect(await v.obter()).toBe('ok');
  });
});
