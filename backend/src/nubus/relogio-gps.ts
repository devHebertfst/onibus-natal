import { Injectable } from '@nestjs/common';
import { config } from '../config.js';
import type { LatLng } from '../linhas/geo.js';
import { horarioNubus, toNumber } from './nubus.parse.js';
import type { NubusPrevisao } from './nubus.types.js';

/** Atrasos fora disso são relógio errado ou ônibus parado há muito, não latência. */
const ATRASO_MAX_MS = 5 * 60_000;
/** Amostras guardadas para a mediana (as mais recentes). */
const MAX_AMOSTRAS = 300;
/** Abaixo disso, a mediana ainda não é confiável. */
const MIN_AMOSTRAS = 5;
/** Hora de GPS de um carro deixa de valer depois disso. */
const ESQUECER_APOS_MS = 10 * 60_000;

interface UltimoGps extends LatLng {
  gpsEm: number;
  vistoEm: number;
}

export interface ResumoAtraso {
  /** Quantas posições tiveram a hora do GPS conferida. */
  amostras: number;
  /** Mediana do atraso medido (s): GPS → API da Nubus → nosso poll. */
  medianaS: number | null;
  p90S: number | null;
  /** O que está sendo descontado das posições sem hora de GPS (s). */
  aplicadoS: number;
}

/**
 * Hora real das posições de GPS.
 *
 * O endpoint do traçado (`ListaParadasEspecificaV2`) dá só a posição de cada
 * ônibus, sem dizer quando o GPS a mediu; o backend carimbava com a hora em
 * que percebeu a mudança, que chega 10–30 s atrasada (GPS → Nubus → poll de
 * 15 s). A previsão de chegada (`/previsoes/paradas`) traz `gpsVeiculoData`
 * dos ônibus a caminho da parada. Este serviço guarda essas horas por carro,
 * mede o atraso típico e o oferece para corrigir as posições sem hora.
 */
@Injectable()
export class RelogioGps {
  private readonly ultimos = new Map<string, UltimoGps>();
  private readonly amostras: number[] = [];

  /** Guarda a hora do GPS de cada ônibus ao vivo de uma resposta de previsão. */
  registrarPrevisoes(
    brutas: NubusPrevisao[] | null | undefined,
    agora: number,
  ): void {
    for (const p of brutas ?? []) {
      if ((p.tipo ?? '').toLowerCase() !== 'on-line') continue;
      const carro = String(p.Carro ?? '').trim();
      const lat = toNumber(p.latitude);
      const lng = toNumber(p.longitude);
      const gpsEm = horarioNubus(p.gpsVeiculoData);
      if (!carro || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      // Hora no futuro ou velha demais: relógio do rastreador errado.
      if (
        !Number.isFinite(gpsEm) ||
        gpsEm > agora + 60_000 ||
        agora - gpsEm > ATRASO_MAX_MS
      )
        continue;
      const anterior = this.ultimos.get(carro);
      if (anterior && anterior.gpsEm >= gpsEm) continue;
      this.ultimos.set(carro, { lat, lng, gpsEm, vistoEm: agora });
    }
    this.esquecerAntigos(agora);
  }

  /** Última posição com hora de GPS conhecida deste carro. */
  ultimoDe(carro: string): (LatLng & { gpsEm: number }) | undefined {
    return this.ultimos.get(carro);
  }

  /** Atraso medido numa posição: quando o backend a viu − quando o GPS a mediu. */
  registrarAtraso(ms: number): void {
    if (!(ms >= 0 && ms <= ATRASO_MAX_MS)) return;
    this.amostras.push(ms);
    if (this.amostras.length > MAX_AMOSTRAS) this.amostras.shift();
  }

  /**
   * Quanto descontar da hora em que o backend viu uma posição sem hora de GPS.
   * Sem amostras suficientes, metade do intervalo do poll: a posição apareceu
   * na API, em média, no meio do intervalo entre duas consultas.
   */
  atrasoEstimadoMs(): number {
    if (this.amostras.length < MIN_AMOSTRAS) return config.pollIntervalMs / 2;
    return quantil(this.amostras, 0.5);
  }

  resumo(): ResumoAtraso {
    const n = this.amostras.length;
    const s = (q: number) =>
      n ? Math.round(quantil(this.amostras, q) / 100) / 10 : null;
    return {
      amostras: n,
      medianaS: s(0.5),
      p90S: s(0.9),
      aplicadoS: Math.round(this.atrasoEstimadoMs() / 100) / 10,
    };
  }

  private esquecerAntigos(agora: number): void {
    for (const [carro, u] of this.ultimos) {
      if (agora - u.vistoEm > ESQUECER_APOS_MS) this.ultimos.delete(carro);
    }
  }
}

function quantil(valores: number[], q: number): number {
  const ord = [...valores].sort((a, b) => a - b);
  return ord[Math.min(ord.length - 1, Math.floor(q * ord.length))];
}
