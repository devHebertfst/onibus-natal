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
