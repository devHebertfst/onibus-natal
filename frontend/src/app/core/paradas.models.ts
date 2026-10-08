/** Espelho de `backend/src/paradas/paradas.dto.ts`. */

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
