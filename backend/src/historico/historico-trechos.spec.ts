import { PGlite } from '@electric-sql/pglite';
import { config } from '../config.js';
import { VelocidadeTrechos } from '../linhas/trechos.js';
import { ArmazemTrechos, type Consulta } from './armazem-trechos.js';
import { HistoricoTrechos, horarioLocal } from './historico-trechos.js';

const DIA = 24 * 60 * 60_000;
/** Sexta-feira, 9/10/2026, 07:10 em Natal (10:10 UTC). */
const SEXTA_7H = Date.parse('2026-10-09T10:10:00Z');

// Um Postgres em memória para o arquivo todo (subir um leva ~1 s).
let db: PGlite;
beforeAll(() => {
  db = new PGlite();
});
afterAll(() => db.close());

async function bancoEmMemoria() {
  await db.query('DROP TABLE IF EXISTS velocidade_trecho');
  return { db, armazem: new ArmazemTrechos(db as Consulta, 14 * DIA) };
}

/** Compara percursos ignorando o decaimento dos milissegundos do teste. */
const perto = (p: { metros: number; segundos: number } | undefined) => ({
  metros: Math.round(p!.metros * 1000) / 1000,
  segundos: Math.round(p!.segundos * 1000) / 1000,
});

const registro = (trecho: number, metros: number, segundos: number) => ({
  itinerario: '101',
  assinatura: 'A',
  tipoDia: 0,
  faixa: 14,
  trecho,
  metros,
  segundos,
});

describe('horarioLocal', () => {
  it('usa o horário de Natal (UTC−3) para o tipo de dia e a faixa', () => {
    expect(horarioLocal(SEXTA_7H)).toEqual({ tipoDia: 0, faixa: 14 });
    // 01:00 UTC de sábado ainda é sexta, 22:00, em Natal
    expect(horarioLocal(Date.parse('2026-10-10T01:00:00Z'))).toEqual({
      tipoDia: 0,
      faixa: 44,
    });
    expect(horarioLocal(SEXTA_7H + DIA).tipoDia).toBe(1); // sábado
    expect(horarioLocal(SEXTA_7H + 2 * DIA).tipoDia).toBe(2); // domingo
  });
});

describe('ArmazemTrechos', () => {
  it('soma as medidas, filtra pelo traçado e recomeça quando ele muda', async () => {
    const { armazem } = await bancoEmMemoria();
    await armazem.gravar([registro(0, 300, 30), registro(1, 150, 60)]);
    await armazem.gravar([registro(0, 300, 90)]);

    const linhas = await armazem.carregar('101', 'A', 0);
    const t0 = linhas.find((l) => l.trecho === 0)!;
    expect(t0.metros).toBeCloseTo(600, 1);
    expect(t0.segundos).toBeCloseTo(120, 1);
    expect(linhas).toHaveLength(2);
    expect(await armazem.carregar('101', 'B', 0)).toEqual([]);
    expect(await armazem.carregar('101', 'A', 1)).toEqual([]);

    // traçado novo: o trecho é substituído, não somado
    await armazem.gravar([{ ...registro(0, 300, 20), assinatura: 'B' }]);
    const novo = await armazem.carregar('101', 'B', 0);
    expect(novo).toHaveLength(1);
    expect(perto(novo[0])).toEqual({ metros: 300, segundos: 20 });
  });

  it('dá menos peso ao que foi gravado há mais tempo', async () => {
    const { db, armazem } = await bancoEmMemoria();
    await armazem.gravar([registro(0, 300, 30)]);
    await db.query(
      `UPDATE velocidade_trecho SET atualizado_em = now() - interval '14 days'`,
    );
    const [t0] = await armazem.carregar('101', 'A', 0);
    expect(t0.metros).toBeCloseTo(150, 0); // uma meia-vida
    expect(t0.metros / t0.segundos).toBeCloseTo(10, 3); // a velocidade não muda
  });
});

describe('HistoricoTrechos', () => {
  it('grava em lote o que foi medido e devolve o típico do horário', async () => {
    const { armazem } = await bancoEmMemoria();
    const h = new HistoricoTrechos(armazem);
    h.registrar('101', 'A', 0, 200, 20, SEXTA_7H);
    h.registrar('101', 'A', 0, 100, 10, SEXTA_7H + 60_000); // mesma faixa
    h.registrar('101', 'A', 1, 300, 60, SEXTA_7H + 30 * 60_000); // faixa seguinte
    expect(h.resumo()).toMatchObject({ ativo: true, pendentes: 2 });
    await h.gravar();
    expect(h.resumo().pendentes).toBe(0);
    expect(h.resumo().ultimaGravacao).not.toBeNull();

    // 1ª consulta dispara a leitura do banco
    expect(h.tipico('101', 'A', SEXTA_7H)).toBeUndefined();
    await vi.waitFor(() => expect(h.resumo().itinerariosCarregados).toBe(1));
    const tipico = h.tipico('101', 'A', SEXTA_7H)!;
    expect(perto(tipico.get(0))).toEqual({ metros: 300, segundos: 30 });
    // a faixa vizinha entra com meio peso
    expect(perto(tipico.get(1))).toEqual({ metros: 150, segundos: 30 });
  });

  it('se o banco falhar, guarda as medidas para a próxima tentativa', async () => {
    const quebrado = new ArmazemTrechos(
      {
        query: () => Promise.reject(new Error('fora do ar')),
      },
      14 * DIA,
    );
    const h = new HistoricoTrechos(quebrado);
    h.registrar('101', 'A', 0, 300, 30, SEXTA_7H);
    await h.gravar();
    expect(h.resumo()).toMatchObject({ pendentes: 1 });
    expect(h.resumo().ultimaFalha).not.toBeNull();
    expect(h.tipico('101', 'A', SEXTA_7H)).toBeUndefined();
  });

  it('sem banco, não guarda nada', () => {
    const h = new HistoricoTrechos(null);
    h.registrar('101', 'A', 0, 300, 30, SEXTA_7H);
    expect(h.resumo()).toMatchObject({ ativo: false, pendentes: 0 });
    expect(h.tipico('101', 'A', SEXTA_7H)).toBeUndefined();
  });
});

describe('VelocidadeTrechos com histórico', () => {
  const M = 1 / 111_195;
  const reta: [number, number][] = Array.from({ length: 21 }, (_, i) => [
    -5.8 + i * 100 * M,
    -35.2,
  ]);
  const em = (metros: number) => ({ lat: -5.8 + metros * M, lng: -35.2 });
  const assinatura = `${reta.length}:${reta[0]}:${reta.at(-1)}`;

  it('preenche com o típico do horário os trechos sem medida recente', async () => {
    const { armazem } = await bancoEmMemoria();
    const h = new HistoricoTrechos(armazem);
    // semana passada, mesmo horário: trechos 0 a 2 a 18 km/h
    for (const k of [0, 1, 2]) {
      h.registrar('ida', assinatura, k, 300, 60, SEXTA_7H - 7 * DIA);
    }
    await h.gravar();

    const v = new VelocidadeTrechos(config.trechos, h);
    v.definirTracados([{ codigo: 'ida', tracado: reta }]);
    // a 1ª atualização da linha espera o histórico chegar do banco
    await v.prepararHistorico(SEXTA_7H, 2_000);
    expect(h.resumo().itinerariosCarregados).toBe(1);

    // agora: trecho 1 medido ao vivo a 36 km/h
    v.observar('ida', 'A', em(300), SEXTA_7H);
    v.observar('ida', 'A', em(600), SEXTA_7H + 30_000);
    const t = v.velocidades('ida', SEXTA_7H + 30_000)!;
    expect(t.kmh.slice(0, 4)).toEqual([18, 36, 18, null]);
    expect(t.mediaKmh).toBe(36); // a média ao vivo vale mais que a típica

    // e o que foi medido agora vai para o histórico
    expect(h.resumo().pendentes).toBe(1);
  });
});
