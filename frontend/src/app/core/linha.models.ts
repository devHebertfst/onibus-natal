/** Espelho de `backend/src/linhas/linha.dto.ts`. */

export interface Parada {
  codigo: string;
  descricao: string;
  ordem: number;
  lat: number;
  lng: number;
}

export interface Itinerario {
  codigo: string;
  descricao: string;
  /** [[lat, lng], ...] no sentido de circulação. */
  tracado: [number, number][];
  paradas: Parada[];
}

export interface Onibus {
  id: string;
  lat: number;
  lng: number;
  /** null = backend ainda não viu duas posições (velocidade desconhecida). */
  velocidadeKmh: number | null;
  itinerarios: string[];
  posicaoDesde: string;
}

export interface Linha {
  numero: string;
  atualizadoEm: string;
  desatualizado: boolean;
  itinerarios: Itinerario[];
  onibus: Onibus[];
}
