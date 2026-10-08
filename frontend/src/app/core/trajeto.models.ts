/** Contrato de GET /api/trajetos. */
export interface LocalTrajeto {
  nome: string;
  lat: number;
  lng: number;
}

export interface PontosTrajeto {
  origem: LocalTrajeto | null;
  destino: LocalTrajeto | null;
}

export interface Trecho {
  modo: 'WALK' | 'BUS';
  inicio: string;
  fim: string;
  duracaoSegundos: number;
  metros: number;
  linha: string | null;
  letreiro: string | null;
  partida: LocalTrajeto;
  chegada: LocalTrajeto;
  tracado: [number, number][];
}

export interface Viagem {
  inicio: string;
  fim: string;
  duracaoSegundos: number;
  caminhadaMetros: number;
  trechos: Trecho[];
}

export interface Trajeto {
  consultadoEm: string;
  viagens: Viagem[];
}

export type TipoPontoTrajeto = 'origem' | 'destino';
