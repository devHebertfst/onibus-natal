import { Injectable } from '@angular/core';
import { LocalTrajeto, Trajeto } from './trajeto.models';

@Injectable({ providedIn: 'root' })
export class TrajetoService {
  async planejar(
    origem: LocalTrajeto,
    destino: LocalTrajeto,
    datetime: string,
    signal: AbortSignal,
  ): Promise<Trajeto> {
    const params = new URLSearchParams({
      from_lat: String(origem.lat),
      from_lng: String(origem.lng),
      to_lat: String(destino.lat),
      to_lng: String(destino.lng),
      datetime,
    });
    const resposta = await fetch(`/api/trajetos?${params}`, { signal });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    return resposta.json() as Promise<Trajeto>;
  }
}
