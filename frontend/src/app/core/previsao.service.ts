import { Injectable } from '@angular/core';
import { Observable, from, switchMap, timer } from 'rxjs';
import { PrevisaoOficial } from './linha.models';
import { ParadaProxima } from './paradas.models';

/** O backend guarda cada parada por 15 s; pedir mais que isso não traz nada novo. */
const INTERVALO_MS = 20_000;

/** Previsão da Nubus para o ponto escolhido e paradas perto do passageiro. */
@Injectable({ providedIn: 'root' })
export class PrevisaoService {
  /**
   * Previsão da Nubus para uma parada, de novo a cada 20 s. Uma falha vira
   * `null` (e não erro): a placa volta para a estimativa própria e a próxima
   * rodada tenta de novo.
   */
  acompanhar(
    numero: string,
    itinerario: string,
    parada: string,
  ): Observable<PrevisaoOficial | null> {
    const url =
      `/api/linhas/${encodeURIComponent(numero)}/previsao?` +
      new URLSearchParams({ itinerario, parada }).toString();
    return timer(0, INTERVALO_MS).pipe(
      switchMap(() =>
        from(
          fetch(url)
            .then((r) => (r.ok ? (r.json() as Promise<PrevisaoOficial>) : null))
            .catch(() => null),
        ),
      ),
    );
  }

  /** Paradas com ônibus perto de uma posição. Lança erro se o servidor não responder. */
  async proximas(lat: number, lng: number): Promise<ParadaProxima[]> {
    const r = await fetch(`/api/paradas/proximas?lat=${lat}&lng=${lng}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as ParadaProxima[];
  }
}
