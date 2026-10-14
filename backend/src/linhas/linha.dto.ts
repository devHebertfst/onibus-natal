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
  /** Velocidade de cada trecho, medida pelos ônibus da linha nos últimos minutos. */
  trechos?: TrechosDto;
}

/**
 * Velocidade por trecho do traçado. O trecho `k` vai de `k·tamanhoM` a
 * `(k+1)·tamanhoM` metros do início do traçado. A velocidade conta o tempo
 * parado (pontos, semáforos, trânsito), então serve direto para estimar
 * tempo de viagem.
 */
export interface TrechosDto {
  tamanhoM: number;
  /** km/h por trecho; null onde nenhum ônibus passou nos últimos ~30 min. */
  kmh: (number | null)[];
  /** Média do itinerário inteiro (para trechos sem dado); null se ainda não há. */
  mediaKmh: number | null;
  /**
   * De onde veio a velocidade de cada trecho, um caractere por trecho: `v`
   * medida agora pelos ônibus da linha, `h` típica do histórico (ajustada
   * pelo trânsito), `t` média típica ajustada pelo trânsito das outras
   * linhas, `-` sem dado (vale `mediaKmh` ou o padrão). Para o placar.
   */
  fontes?: string;
}

/**
 * Correção da nossa previsão aprendida com o placar (pelo viés mediano): a
 * `minutos[i]` da chegada, a previsão costuma errar `correcaoMin[i]` (> 0:
 * chega antes do previsto). Entre os pontos, interpolação linear; depois do
 * último, o último. O app subtrai a correção do que calculou.
 */
export interface AjustePrevisaoDto {
  minutos: number[];
  correcaoMin: number[];
  /**
   * Correção própria da linha, quando ela tem chegadas suficientes: a
   * fração da previsão que ela costuma errar (−0,5: chega 50% mais tarde).
   * Vale no lugar da curva geral; o app subtrai `fracaoLinha × previsão`.
   */
  fracaoLinha?: number;
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
  /** Ausente enquanto o placar não tem chegadas suficientes. */
  ajustePrevisao?: AjustePrevisaoDto;
}

/** Um ônibus (ou uma viagem da tabela) a caminho da parada. */
export interface ChegadaDto {
  /** Veículo; null nas viagens da tabela, que ainda não têm ônibus com GPS. */
  onibus: string | null;
  /** true: ônibus com GPS ligado; false: horário programado da tabela. */
  aoVivo: boolean;
  /** Horário previsto de chegada (ISO 8601). */
  chegaEm: string;
  /** Distância do ônibus até a parada pelo trajeto (m); null na tabela. */
  metros: number | null;
  /** Horário da posição de GPS que a Nubus usou na conta; null na tabela. */
  gpsEm: string | null;
}

/** Resposta de `GET /api/linhas/:numero/previsao?itinerario=&parada=`. */
export interface PrevisaoDto {
  itinerario: string;
  parada: string;
  /** Quando o backend consultou a API de transporte. */
  consultadoEm: string;
  /** Do que chega primeiro ao que chega por último. */
  chegadas: ChegadaDto[];
}
