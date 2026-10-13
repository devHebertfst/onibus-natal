import { BadGatewayException, Injectable } from '@nestjs/common';
import { CachePersistente } from '../banco/cache-persistente.js';
import { ValorGuardado } from '../banco/valor-guardado.js';
import { config } from '../config.js';
import { emParalelo, numeroDaLinha } from '../linhas/linhas.service.js';
import { NubusClient } from './nubus.client.js';
import type { NubusItinerario } from './nubus.types.js';

export interface LinhaCatalogo {
  numero: string;
  descricoes: string[];
}

/**
 * Compartilha a busca de rotas entre o catálogo de linhas e o índice de
 * paradas. São 10 consultas à API; o resultado fica guardado no banco, para
 * o servidor não repeti-las toda vez que acorda.
 */
@Injectable()
export class CatalogoRotasService {
  private readonly guardado: ValorGuardado<NubusItinerario[]>;

  constructor(
    private readonly nubus: NubusClient,
    cache: CachePersistente = new CachePersistente(null),
  ) {
    this.guardado = new ValorGuardado(cache, {
      chave: 'catalogo-rotas:v1',
      validadeMs: config.itinerariosTtlMs,
      montar: () => this.consultar(),
    });
  }

  async rotas(): Promise<NubusItinerario[]> {
    return this.guardado.obter().catch(() => {
      throw new BadGatewayException('Catálogo de linhas indisponível');
    });
  }

  async linhas(): Promise<LinhaCatalogo[]> {
    const linhas = new Map<string, Set<string>>();
    for (const rota of await this.rotas()) {
      const numero = numeroDaLinha(rota.descricaolinha ?? '');
      if (!/^[A-Z0-9.-]{1,10}$/.test(numero)) continue;
      let nomes = linhas.get(numero);
      if (!nomes) linhas.set(numero, (nomes = new Set()));
      const descricao = (rota.descricaoItinerario ?? '').trim();
      if (descricao) nomes.add(descricao);
    }
    return [...linhas]
      .map(([numero, descricoes]) => ({
        numero,
        descricoes: [...descricoes].sort((a, b) => a.localeCompare(b, 'pt-BR')),
      }))
      .sort((a, b) =>
        a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }),
      );
  }

  private async consultar(): Promise<NubusItinerario[]> {
    const rotas = new Map<string, NubusItinerario>();
    // A API rejeita busca vazia. Cada dígito traz as linhas que contêm esse número.
    await emParalelo([...'0123456789'], 2, async (digito) => {
      for (const rota of await this.nubus.pesquisarRotas(digito)) {
        if (
          rota.codigoItinerario == null ||
          rota.codigoItinerario === '' ||
          !rota.descricaolinha
        )
          continue;
        rotas.set(String(rota.codigoItinerario), rota);
      }
    });
    return [...rotas.values()];
  }
}
