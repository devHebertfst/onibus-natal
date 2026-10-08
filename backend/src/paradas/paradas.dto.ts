/** Contrato de `GET /api/paradas/proximas`. Cópia no frontend: `core/paradas.models.ts`. */

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
