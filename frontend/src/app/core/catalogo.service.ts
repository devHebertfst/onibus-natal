import { Injectable } from '@angular/core';

export interface LinhaCatalogo {
  numero: string;
  descricoes: string[];
}

@Injectable({ providedIn: 'root' })
export class CatalogoService {
  async listar(signal?: AbortSignal): Promise<LinhaCatalogo[]> {
    const resposta = await fetch('/api/linhas/catalogo', { signal });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    return resposta.json() as Promise<LinhaCatalogo[]>;
  }
}
