/**
 * Contrato da resposta de `GET /api/linhas/:numero`. O frontend tem uma cópia
 * destes tipos em `frontend/src/app/core/linha.models.ts`.
 */

export interface ParadaDto {
  codigo: string;
  descricao: string;
  ordem: number;
  lat: number;
  lng: number;
}

export interface ItinerarioDto {
  codigo: string;
  descricao: string;
  /** Traçado ordenado no sentido de circulação: [[lat, lng], ...]. */
  tracado: [number, number][];
  paradas: ParadaDto[];
}

export interface OnibusDto {
  /** Identificador do veículo (campo `carro` da API). */
  id: string;
  lat: number;
  lng: number;
  /**
   * Média móvel de ~90s; 0 se não se move há mais de 60s; `null` enquanto o
   * backend ainda não viu duas posições diferentes (linha recém-acompanhada).
   */
  velocidadeKmh: number | null;
  /** Itinerários em que o veículo apareceu (pode ser mais de um). */
  itinerarios: string[];
  /** Quando o backend viu esta posição pela 1ª vez (ISO 8601). */
  posicaoDesde: string;
}

export interface LinhaDto {
  numero: string;
  /** Horário do servidor no momento da última consulta bem-sucedida. */
  atualizadoEm: string;
  /** true se a última tentativa de atualização falhou (dados podem estar velhos). */
  desatualizado: boolean;
  itinerarios: ItinerarioDto[];
  onibus: OnibusDto[];
}
