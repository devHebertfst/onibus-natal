import { Logger } from '@nestjs/common';
import type { CachePersistente } from './cache-persistente.js';

export interface OpcoesValorGuardado<T, S> {
  /** Chave no banco. Mude o sufixo de versão se o formato mudar. */
  chave: string;
  /** Depois disso o valor é remontado (em segundo plano, se já houver um). */
  validadeMs: number;
  /** Monta o valor do zero (na API de origem). */
  montar: () => Promise<T>;
  /** Como o valor vai para o banco e volta (padrão: como está, em JSON). */
  serializar?: (valor: T) => S;
  desserializar?: (salvo: S) => T;
  /** Depois de uma falha ao remontar, espera isso para tentar de novo. */
  esperaAposFalhaMs?: number;
}

interface Salvo<S> {
  em: number;
  valor: S;
}

/**
 * Um valor caro de montar que muda pouco: fica em memória e no banco.
 *
 * - Ao acordar, o servidor lê o valor do banco em vez de remontar.
 * - Vencido, o valor antigo continua sendo servido enquanto o novo é montado
 *   por trás: ninguém espera a remontagem.
 * - Só espera a montagem quem pede sem haver valor nenhum (1ª vez de todas).
 * - Pedidos simultâneos compartilham a mesma montagem.
 */
export class ValorGuardado<T, S = T> {
  private readonly logger = new Logger(ValorGuardado.name);
  private atual?: { valor: T; em: number };
  private leitura?: Promise<void>;
  private montagem?: Promise<T>;
  private falhouEm = 0;

  constructor(
    private readonly cache: CachePersistente,
    private readonly o: OpcoesValorGuardado<T, S>,
  ) {}

  async obter(agora = Date.now()): Promise<T> {
    this.leitura ??= this.lerDoBanco();
    await this.leitura;

    const atual = this.atual;
    if (!atual) return this.remontar(agora);
    if (agora - atual.em >= this.o.validadeMs) {
      const espera = this.o.esperaAposFalhaMs ?? 5 * 60_000;
      if (!this.montagem && agora - this.falhouEm >= espera) {
        this.remontar(agora).catch((e: unknown) =>
          this.logger.warn(
            `Falha ao atualizar "${this.o.chave}"; seguindo com a versão de ${new Date(atual.em).toISOString()}: ${(e as Error).message}`,
          ),
        );
      }
    }
    return atual.valor;
  }

  /** Quando o valor em uso foi montado (ou `undefined` se ainda não há). */
  get montadoEm(): number | undefined {
    return this.atual?.em;
  }

  private remontar(agora: number): Promise<T> {
    this.montagem ??= this.o
      .montar()
      .then((valor) => {
        const em = Date.now();
        this.atual = { valor, em };
        const salvo: Salvo<S> = {
          em,
          valor: this.o.serializar
            ? this.o.serializar(valor)
            : (valor as unknown as S),
        };
        void this.cache.gravar(this.o.chave, salvo);
        return valor;
      })
      .catch((e: unknown) => {
        this.falhouEm = agora;
        throw e;
      })
      .finally(() => {
        this.montagem = undefined;
      });
    return this.montagem;
  }

  private async lerDoBanco(): Promise<void> {
    const salvo = await this.cache.ler<Salvo<S>>(this.o.chave);
    if (!salvo || this.atual) return;
    try {
      this.atual = {
        em: salvo.em,
        valor: this.o.desserializar
          ? this.o.desserializar(salvo.valor)
          : (salvo.valor as unknown as T),
      };
      this.logger.log(
        `"${this.o.chave}" lido do banco (de ${new Date(salvo.em).toISOString()})`,
      );
    } catch (e) {
      this.logger.warn(
        `"${this.o.chave}" no banco não serve: ${(e as Error).message}`,
      );
    }
  }
}
