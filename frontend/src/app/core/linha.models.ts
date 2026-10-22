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
  /** Velocidade por trecho medida pelos ônibus da linha (ausente em backend antigo). */
  trechos?: Trechos;
}

/** Espelho de `TrechosDto`: o trecho `k` vai de `k·tamanhoM` a `(k+1)·tamanhoM` metros. */
export interface Trechos {
  tamanhoM: number;
  /** km/h por trecho, tempo parado incluído; null onde não há medida recente. */
  kmh: (number | null)[];
  mediaKmh: number | null;
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

/** Espelho de `ChegadaDto`: um ônibus (ou uma viagem da tabela) a caminho da parada. */
export interface Chegada {
  /** null nas viagens da tabela (ainda sem ônibus com GPS). */
  onibus: string | null;
  aoVivo: boolean;
  /** ISO 8601. */
  chegaEm: string;
  metros: number | null;
  gpsEm: string | null;
}

/** Espelho de `PrevisaoDto`: a previsão da Nubus para uma parada de um itinerário. */
export interface PrevisaoOficial {
  itinerario: string;
  parada: string;
  consultadoEm: string;
  chegadas: Chegada[];
}
