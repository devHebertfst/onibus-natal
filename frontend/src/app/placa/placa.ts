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
}

/**
 * Placa de chegada: o ponto do passageiro como uma placa de indicação —
 * verde, filete branco, uma linha por sentido com seta, destino e tempo.
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
      return {
        ...s,
        // Quebra de linha só entre os nomes ("Ribeira / Cidade Nova"), nunca no meio de um.
        destino: s.destino
          .split(' / ')
          .map((parte) => parte.replace(/ /g, '\u00a0'))
          .join('\u00a0/ '),
        proximo: proximo
          ? {
              chegando: proximo.minutos < 1,
              minutos: Math.max(1, Math.round(proximo.minutos)),
              detalhe: `${
                proximo.paradas === 0
                  ? 'seu ponto é a próxima parada'
                  : `a ${proximo.paradas} ${proximo.paradas === 1 ? 'parada' : 'paradas'} daqui`
              } (${distanciaTexto(proximo.metros)})`,
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
