import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { CachePersistente } from '../banco/cache-persistente.js';
import { config } from '../config.js';
import { ParadasService } from '../paradas/paradas.service.js';
import type { ItinerarioMalha } from '../trajetos/roteador.js';
import { quadrasDoTracado } from './celulas.js';
import { LinhasService, emParalelo } from './linhas.service.js';

export type ParametrosColeta = typeof config.coleta;

export interface ResumoColeta {
  ativa: boolean;
  horas: string;
  /** Linhas lidas pelo coletor (null até a 1ª escolha automática). */
  linhas: string[] | null;
  /** Trocadas por não terem ônibus andando (ficam fora da escolha por uns dias). */
  descartadas: string[];
  ultimaRajada: string | null;
  rajadas: number;
}

const DIA_MS = 24 * 60 * 60_000;
/** Rajadas seguidas sem nenhuma medida para uma troncal ser trocada. */
const RAJADAS_SEM_MEDIDA = 2;
/** Linha → quando foi trocada (ms), guardado no banco. */
const CHAVE_DESCARTADAS = 'coletor-descartadas:v1';

/**
 * Coletor por amostras das linhas troncais: nas faixas de horário
 * configuradas, a cada 15 min, lê cada troncal duas vezes com 1 min entre
 * as leituras (o bastante para os ônibus andarem e a velocidade ser medida)
 * e para. Cada rajada custa 2 consultas por sentido de cada linha.
 *
 * O que ele mede alimenta o histórico de velocidade por trecho e o trânsito
 * compartilhado: quem abrir outra linha que passa pelas mesmas ruas já
 * recebe a previsão ajustada, mesmo sem ninguém ter aberto a troncal.
 *
 * No modo automático, uma troncal que passa 2 rajadas seguidas sem medir
 * nada (sem ônibus rodando naquele horário, como uma expressa fora do pico)
 * dá lugar à próxima melhor candidata. A trocada fica fora da escolha por
 * 7 dias (guardado no banco, sobrevive ao servidor dormir), para não gastar
 * de novo o começo de cada pico com ela; depois volta a ser testada, caso
 * passe a ter ônibus com GPS.
 */
@Injectable()
export class ColetorTroncais {
  private readonly logger = new Logger(ColetorTroncais.name);
  private escolhidas?: { linhas: string[]; em: number; auto: boolean };
  private readonly descartadas = new Map<string, number>();
  private descartadasLidas?: Promise<void>;
  private readonly semMedida = new Map<string, number>();
  private ultimaRajada = 0;
  private rajadas = 0;
  private rodando = false;
  private readonly faixas: [number, number][];

  constructor(
    private readonly linhas: LinhasService,
    private readonly paradas: ParadasService,
    @Optional()
    @Inject('PARAMETROS_COLETA')
    private readonly p: ParametrosColeta = config.coleta,
    @Optional()
    @Inject(CachePersistente)
    private readonly cache: CachePersistente | null = null,
  ) {
    this.faixas = lerFaixas(p.horas);
  }

  /** Confere a cada minuto se é hora de uma rajada. */
  @Interval('coletor-troncais', 60_000)
  async tique(agora = Date.now()): Promise<void> {
    if (!this.p.ativa || this.rodando) return;
    if (!dentroDasFaixas(agora, this.faixas)) return;
    if (agora - this.ultimaRajada < this.p.intervaloMs) return;
    this.rodando = true;
    this.ultimaRajada = agora;
    try {
      await this.rajada(agora);
    } finally {
      this.rodando = false;
    }
  }

  /** Duas leituras de cada troncal, com a pausa entre elas. */
  async rajada(agora = Date.now()): Promise<void> {
    const linhas = await this.linhasDaColeta(agora);
    if (linhas.length === 0) return;
    const primeira = await this.lerTodas(linhas);
    await new Promise((r) => setTimeout(r, this.p.pausaMs));
    const segunda = await this.lerTodas(linhas);
    this.rajadas++;

    if (!this.escolhidas?.auto) return;
    for (const numero of linhas) {
      const a = primeira.get(numero);
      const b = segunda.get(numero);
      if (a === null || b === null) continue; // não leu (aberta por alguém)
      if ((a ?? 0) + (b ?? 0) > 0) this.semMedida.delete(numero);
      else this.semMedida.set(numero, (this.semMedida.get(numero) ?? 0) + 1);
    }
    const trocar = linhas.filter(
      (n) => (this.semMedida.get(n) ?? 0) >= RAJADAS_SEM_MEDIDA,
    );
    if (trocar.length > 0) await this.trocar(trocar, agora);
  }

  resumo(): ResumoColeta {
    return {
      ativa: this.p.ativa,
      horas: this.p.horas,
      linhas: this.escolhidas?.linhas ?? null,
      descartadas: [...this.descartadas.keys()],
      ultimaRajada: this.ultimaRajada
        ? new Date(this.ultimaRajada).toISOString()
        : null,
      rajadas: this.rajadas,
    };
  }

  /** Lê cada linha; devolve quantas medidas cada leitura rendeu. */
  private async lerTodas(
    linhas: string[],
  ): Promise<Map<string, number | null | undefined>> {
    const rendeu = new Map<string, number | null | undefined>();
    await emParalelo(linhas, 2, async (numero) => {
      try {
        rendeu.set(numero, await this.linhas.coletar(numero));
      } catch (e) {
        // Falha da API não é falta de ônibus: não conta para a troca.
        rendeu.set(numero, null);
        this.logger.warn(
          `Coletor: falha ao ler a linha ${numero}: ${(e as Error).message}`,
        );
      }
    });
    return rendeu;
  }

  /** Troca as troncais sem ônibus andando pelas próximas melhores. */
  private async trocar(sem: string[], agora: number): Promise<void> {
    for (const n of sem) {
      this.descartadas.set(n, agora);
      this.semMedida.delete(n);
    }
    await this.cache?.gravar(
      CHAVE_DESCARTADAS,
      Object.fromEntries(this.descartadas),
    );
    try {
      const linhas = escolherTroncais(
        await this.paradas.malha(),
        this.p.quantasAuto,
        new Set(this.descartadas.keys()),
      );
      this.escolhidas = {
        linhas,
        em: this.escolhidas?.em ?? agora,
        auto: true,
      };
      this.logger.log(
        `Coletor: ${sem.join(', ')} sem ônibus andando; troncais agora ${linhas.join(', ')}`,
      );
    } catch (e) {
      this.logger.warn(
        `Coletor: não deu para trocar as troncais: ${(e as Error).message}`,
      );
    }
  }

  /** As trocadas antes do servidor reiniciar (uma vez só). */
  private lerDescartadas(): Promise<void> {
    return (this.descartadasLidas ??= (async () => {
      const salvas =
        await this.cache?.ler<Record<string, number>>(CHAVE_DESCARTADAS);
      for (const [n, em] of Object.entries(salvas ?? {})) {
        if (typeof em === 'number' && !this.descartadas.has(n))
          this.descartadas.set(n, em);
      }
    })());
  }

  /** As da configuração ou, em "auto", as que mais cobrem ruas em comum. */
  private async linhasDaColeta(agora: number): Promise<string[]> {
    if (this.escolhidas && agora - this.escolhidas.em < DIA_MS)
      return this.escolhidas.linhas;

    if (this.p.linhas.trim().toLowerCase() !== 'auto') {
      const linhas = this.p.linhas
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean);
      this.escolhidas = { linhas, em: agora, auto: false };
      return linhas;
    }

    // Escolha nova a cada dia; as trocadas há mais de 7 dias voltam a concorrer.
    await this.lerDescartadas();
    for (const [n, em] of this.descartadas) {
      if (agora - em >= this.p.descarteMs) this.descartadas.delete(n);
    }
    this.semMedida.clear();
    try {
      const linhas = escolherTroncais(
        await this.paradas.malha(),
        this.p.quantasAuto,
        new Set(this.descartadas.keys()),
      );
      this.escolhidas = { linhas, em: agora, auto: true };
      this.logger.log(`Coletor: troncais escolhidas ${linhas.join(', ')}`);
      return linhas;
    } catch (e) {
      this.logger.warn(
        `Coletor: sem índice de paradas para escolher as troncais: ${(e as Error).message}`,
      );
      return [];
    }
  }
}

/**
 * Escolhe as linhas que, juntas, mais cobrem ruas por onde passam outras
 * linhas: cada pedaço de rua vale quantas outras linhas passam nele, e uma
 * vez coberto não conta de novo (escolha gulosa).
 */
export function escolherTroncais(
  malha: ItinerarioMalha[],
  quantas: number,
  /** Não podem ser escolhidas (mas suas ruas continuam contando). */
  excluidas: ReadonlySet<string> = new Set(),
): string[] {
  const quadrasPorLinha = new Map<string, Set<string>>();
  for (const it of malha) {
    if (!it.numero || it.tracado.length < 2) continue;
    let quadras = quadrasPorLinha.get(it.numero);
    if (!quadras) quadrasPorLinha.set(it.numero, (quadras = new Set()));
    for (const q of quadrasDoTracado(it.tracado)) quadras.add(q);
  }

  const linhasPorQuadra = new Map<string, number>();
  for (const quadras of quadrasPorLinha.values()) {
    for (const q of quadras)
      linhasPorQuadra.set(q, (linhasPorQuadra.get(q) ?? 0) + 1);
  }

  const cobertas = new Set<string>();
  const escolhidas: string[] = [];
  while (escolhidas.length < quantas) {
    let melhor: string | undefined;
    let ganhoMelhor = 0;
    for (const [linha, quadras] of quadrasPorLinha) {
      if (escolhidas.includes(linha) || excluidas.has(linha)) continue;
      let ganho = 0;
      for (const q of quadras) {
        if (!cobertas.has(q)) ganho += linhasPorQuadra.get(q)! - 1;
      }
      if (
        ganho > ganhoMelhor ||
        (ganho === ganhoMelhor &&
          melhor !== undefined &&
          linha.localeCompare(melhor, 'pt-BR', { numeric: true }) < 0)
      ) {
        melhor = linha;
        ganhoMelhor = ganho;
      }
    }
    if (melhor === undefined) break;
    escolhidas.push(melhor);
    for (const q of quadrasPorLinha.get(melhor)!) cobertas.add(q);
  }
  return escolhidas;
}

/** "6-9,16-19" → [[6, 9], [16, 19]] (horas de Natal, fim exclusivo). */
export function lerFaixas(texto: string): [number, number][] {
  return texto
    .split(',')
    .map((f) => f.trim().split('-').map(Number))
    .filter(
      (f): f is [number, number] =>
        f.length === 2 &&
        f.every((h) => Number.isInteger(h) && h >= 0 && h <= 24) &&
        f[0] < f[1],
    );
}

export function dentroDasFaixas(
  t: number,
  faixas: [number, number][],
  fusoMin = config.historico.fusoMin,
): boolean {
  const local = new Date(t + fusoMin * 60_000);
  const hora = local.getUTCHours() + local.getUTCMinutes() / 60;
  return faixas.some(([ini, fim]) => hora >= ini && hora < fim);
}
