export interface LocalTrajetoDto {
  nome: string;
  lat: number;
  lng: number;
}

export interface TrechoDto {
  modo: 'WALK' | 'BUS';
  inicio: string;
  fim: string;
  duracaoSegundos: number;
  metros: number;
  linha: string | null;
  letreiro: string | null;
  partida: LocalTrajetoDto;
  chegada: LocalTrajetoDto;
  tracado: [number, number][];
}

export interface ViagemDto {
  inicio: string;
  fim: string;
  duracaoSegundos: number;
  caminhadaMetros: number;
  trechos: TrechoDto[];
}

export interface TrajetoDto {
  consultadoEm: string;
  viagens: ViagemDto[];
}
