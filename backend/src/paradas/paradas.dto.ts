/** Contrato de `GET /api/paradas/...`. Cópia no frontend: `core/paradas.models.ts`. */

import type { ChegadaDto } from '../linhas/linha.dto.js';

export interface LinhaNaParadaDto {
  /** Número como o passageiro digita ("33", "SE17"). */
  numero: string;
  /** Nomes dos itinerários que passam aqui ("Planalto / Praia do Meio"). */
  itinerarios: string[];
}

export interface ParadaProximaDto {
  codigo: string;
  /** Endereço completo, como vem da API. */
  descricao: string;
  lat: number;
  lng: number;
  /** Distância em linha reta até a posição pedida (m). */
  metros: number;
  linhas: LinhaNaParadaDto[];
}

/** Um sentido de uma linha numa parada, com os próximos ônibus. */
export interface PrevisaoItinerarioDto {
  numero: string;
  itinerario: string;
  /** Nome do itinerário ("Planalto / Praia do Meio"). */
  descricao: string;
  /** null: a API de transporte não respondeu para este itinerário. */
  chegadas: ChegadaDto[] | null;
}

/** Contrato de `GET /api/paradas/:codigo/previsao`. */
export interface PrevisaoParadaDto {
  parada: string;
  consultadoEm: string;
  /** Do sentido que chega primeiro ao que não tem previsão. */
  itinerarios: PrevisaoItinerarioDto[];
}
