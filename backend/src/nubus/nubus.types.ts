/**
 * Formato bruto das respostas da API Nubus. Os campos numéricos às vezes vêm
 * como string, por isso são tipados como `number | string` e convertidos em
 * `nubus.parse.ts`.
 */

/** Item de `POST /previsoes/PesquisaRotas`. */
export interface NubusItinerario {
  codigoItinerario: string | number;
  descricaoItinerario: string;
  /** Ex.: "CDNO-33", "CMPO-33A", "COM133". */
  codigolinha?: string;
  /** Número exibido da linha, às vezes com prefixo: "O-33", "O-33 Extra", "133". */
  descricaolinha?: string;
}

export interface NubusParada {
  codigo: string | number;
  Lat: number | string;
  Long: number | string;
  descricao: string;
  ordem: number | string;
}

export interface NubusCarro {
  carro: string | number;
  Lat: number | string;
  Long: number | string;
}

/**
 * Item de `POST /previsoes/ListaParadasEspecificaV2` (a API devolve uma lista
 * com um item por itinerário pedido).
 */
export interface NubusParadasEspecifica {
  paradas?: NubusParada[] | null;
  /** Traçado: "lat long|lat long|..." */
  pontos?: string | null;
  carros?: NubusCarro[] | null;
}

/** Item de `POST /previsoes/listaparadasv2`: todas as paradas da cidade. */
export interface NubusParadaCidade {
  /** "PARADA#100018": o mesmo código das paradas dos itinerários. */
  codigo: string;
  Lat: number | string;
  Long: number | string;
  /** Código interno curto ("S00018"). */
  nome?: string | null;
  /** Endereço completo. */
  descricao?: string | null;
  apelido?: string | null;
}

/**
 * Item de `POST /previsoes/paradas`: um ônibus (ou uma viagem da tabela) a
 * caminho da parada. `[]` quando não vem nenhum.
 */
export interface NubusPrevisao {
  /** Veículo ("CDN70061"), o mesmo `carro` do traçado; "FKEPlanejado" para viagem programada. */
  Carro?: string | null;
  /** "On-line" (GPS ao vivo) ou "Off-line" (horário da tabela). */
  tipo?: string | null;
  /** Arredondado para minutos inteiros. */
  Minutos?: number | string | null;
  /** Horário local de Natal, sem fuso: "2026-10-07T19:34:28.0000001". */
  PrevisaoDeChegada?: string | null;
  distanciaVeiculoMetros?: number | string | null;
  /** m/s. */
  velocidadeVeiculoConsiderada?: number | string | null;
  /** Horário da última posição de GPS (com fuso). */
  gpsVeiculoData?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  /** Para onde o ônibus segue ("Praia do Meio"). */
  descricaoSentido?: string | null;
}
