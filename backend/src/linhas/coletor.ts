import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
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
  ultimaRajada: string | null;
  rajadas: number;
}

const DIA_MS = 24 * 60 * 60_000;

/**
 * Coletor por amostras das linhas troncais: nas faixas de horário
 * configuradas, a cada 15 min, lê cada troncal duas vezes com 1 min entre
 * as leituras (o bastante para os ônibus andarem e a velocidade ser medida)
 * e para. Cada rajada custa 2 consultas por sentido de cada linha.
 *
 * O que ele mede alimenta o histórico de velocidade por trecho e o trânsito
 * compartilhado: quem abrir outra linha que passa pelas mesmas ruas já
 * recebe a previsão ajustada, mesmo sem ninguém ter aberto a troncal.
 */
@Injectable()
export class ColetorTroncais {
  private readonly logger = new Logger(ColetorTroncais.name);
  private escolhidas?: { linhas: string[]; em: number };
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
    await this.lerTodas(linhas);
    await new Promise((r) => setTimeout(r, this.p.pausaMs));
    await this.lerTodas(linhas);
    this.rajadas++;
  }

  resumo(): ResumoColeta {
    return {
      ativa: this.p.ativa,
      horas: this.p.horas,
      linhas: this.escolhidas?.linhas ?? null,
      ultimaRajada: this.ultimaRajada
        ? new Date(this.ultimaRajada).toISOString()
        : null,
      rajadas: this.rajadas,
    };
  }

  private async lerTodas(linhas: string[]): Promise<void> {
    await emParalelo(linhas, 2, async (numero) => {
      try {
        await this.linhas.coletar(numero);
      } catch (e) {
        this.logger.warn(
          `Coletor: falha ao ler a linha ${numero}: ${(e as Error).message}`,
        );
      }
    });
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
      this.escolhidas = { linhas, em: agora };
      return linhas;
    }

    try {
      const linhas = escolherTroncais(
        await this.paradas.malha(),
        this.p.quantasAuto,
      );
      this.escolhidas = { linhas, em: agora };
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
      if (escolhidas.includes(linha)) continue;
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
