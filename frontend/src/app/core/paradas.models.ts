/** Espelho de `backend/src/paradas/paradas.dto.ts`. */

import { Chegada } from './linha.models';

export interface LinhaNaParada {
  numero: string;
  itinerarios: string[];
}

export interface ParadaProxima {
  codigo: string;
  descricao: string;
  lat: number;
  lng: number;
  /** Distância em linha reta até o passageiro (m). */
  metros: number;
  linhas: LinhaNaParada[];
}

export interface PrevisaoItinerario {
  numero: string;
  itinerario: string;
  descricao: string;
  /** null: a API de transporte não respondeu para este itinerário. */
  chegadas: Chegada[] | null;
}

/** Próximos ônibus de cada linha que passa numa parada. */
export interface PrevisaoParada {
  parada: string;
  consultadoEm: string;
  itinerarios: PrevisaoItinerario[];
}
