import { Component, computed, input } from '@angular/core';
import { distanciaTexto } from '../core/texto';
import { Previsao } from '../mapa/dead-reckoning/previsao';

/** Um sentido da linha passando pelo ponto. */
export interface SentidoNaPlaca {
  itinerario: string;
  destino: string;
  cor: string;
  /** Rumo do traçado na parada (graus, 0 = norte); null se desconhecido. */
  rumo: number | null;
  previsoes: Previsao[];
  /** Por que o ônibus seguido mudou ("o ônibus X já passou"), por alguns segundos. */
  aviso: string | null;
  /** De onde vem o tempo: previsão da Nubus ou estimativa própria (velocidade por trecho). */
  fonte: 'nubus' | 'estimativa';
  /** Próxima viagem da tabela ("20:55"), quando nenhum ônibus com GPS vem. */
  tabela: string | null;
}

const RUMOS = [
  ['N', 'norte'],
  ['NE', 'nordeste'],
  ['L', 'leste'],
  ['SE', 'sudeste'],
  ['S', 'sul'],
  ['SO', 'sudoeste'],
  ['O', 'oeste'],
  ['NO', 'noroeste'],
] as const;

/** 200° → ['SO', 'sudoeste']. */
function rumoTexto(graus: number): readonly [string, string] {
  return RUMOS[Math.round((((graus % 360) + 360) % 360) / 45) % 8];
}

/**
 * Placa de chegada: o ponto do passageiro como uma placa de indicação —
 * verde, filete branco, uma linha por sentido com seta, destino e tempo.
 * O conteúdo com o atributo `acao` vai no cabeçalho, ao lado do nome.
 */
@Component({
  selector: 'app-placa',
  templateUrl: './placa.html',
  styleUrl: './placa.scss',
})
export class Placa {
  readonly nome = input.required<string>();
  readonly sentidos = input.required<SentidoNaPlaca[]>();
  readonly idPlaca = input('placa-ponto');
  /** É o ponto salvo do passageiro nesta linha. */
  readonly salvo = input(false);

  protected readonly linhas = computed(() =>
    this.sentidos().map((s) => {
      const [proximo, ...depois] = s.previsoes;
      const rumo = s.rumo === null ? null : rumoTexto(s.rumo);
      return {
        ...s,
        // Quebra de linha só entre os nomes ("Ribeira / Cidade Nova"), nunca no meio de um.
        destino: s.destino
          .split(' / ')
          .map((parte) => parte.replace(/ /g, ' '))
          .join(' / '),
        rumoCurto: rumo?.[0] ?? null,
        rumoLongo: rumo ? `indo para o ${rumo[1]}` : null,
        proximo: proximo
          ? {
              onibus: proximo.onibus,
              chegando: proximo.minutos < 1,
              minutos: Math.max(1, Math.round(proximo.minutos)),
              detalhe:
                proximo.paradas === null
                  ? proximo.metros === null
                    ? 'Distância não informada'
                    : `a ${distanciaTexto(proximo.metros)} daqui`
                  : `${
                      proximo.paradas === 0
                        ? 'seu ponto é a próxima parada'
                        : `a ${proximo.paradas} ${proximo.paradas === 1 ? 'parada' : 'paradas'} daqui`
                    }${proximo.metros === null ? '' : ` (${distanciaTexto(proximo.metros)})`}`,
            }
          : null,
        depois: depois.length
          ? `depois: ${depois
              .slice(0, 2)
              .map((p) => Math.max(1, Math.round(p.minutos)))
              .join(' e ')} min`
          : null,
      };
    }),
  );
}
