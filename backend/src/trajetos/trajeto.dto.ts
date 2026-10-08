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
  /**
   * Ônibus: de onde vem o horário em que ele passa no ponto ('ao-vivo': GPS;
   * 'tabela': horário programado; 'estimada': sem previsão, espera média).
   */
  fonteHorario?: 'ao-vivo' | 'tabela' | 'estimada';
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
