/**
 * Formato bruto das respostas da API Nubus. Os campos numéricos às vezes vêm
 * como string, por isso são tipados como `number | string` e convertidos em
 * `nubus.parse.ts`.
 */

/** Item de `POST /previsoes/PesquisaRotas`. */
export interface NubusItinerario {
  codigoItinerario: string | number;
  descricaoItinerario: string;
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

/** Resposta de `POST /previsoes/ListaParadasEspecificaV2`. */
export interface NubusParadasEspecifica {
  paradas?: NubusParada[] | null;
  /** Traçado: "lat long|lat long|..." */
  pontos?: string | null;
  carros?: NubusCarro[] | null;
}
