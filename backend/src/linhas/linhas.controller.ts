import { Controller, Get, HttpException, Param, Sse } from '@nestjs/common';
import {
  Observable,
  catchError,
  interval,
  map,
  merge,
  of,
  takeWhile,
} from 'rxjs';
import { config } from '../config.js';
import type { LinhaDto } from './linha.dto.js';
import { LinhasService } from './linhas.service.js';

/** Formato dos eventos de `GET /api/linhas/:numero/stream`. */
type EventoSse =
  | {
      type: 'linha' | 'erro';
      data: object;
      /** Quanto o EventSource espera antes de reconectar (ms). */
      retry?: number;
    }
  /** Comentário SSE: mantém a conexão viva e o EventSource ignora. */
  | { comment: string };

@Controller('linhas')
export class LinhasController {
  constructor(private readonly linhas: LinhasService) {}

  /** Linhas que o backend está acompanhando agora. */
  @Get()
  listar(): string[] {
    return this.linhas.acompanhadas();
  }

  /** Ônibus (com posição e velocidade), paradas e traçado de uma linha. */
  @Get(':numero')
  obter(@Param('numero') numero: string): Promise<LinhaDto> {
    return this.linhas.obter(numero);
  }

  /**
   * Server-Sent Events: o snapshot atual e cada atualização do loop, assim
   * que sai. Erros viram um evento `erro` (com o status HTTP equivalente) e
   * encerram o fluxo; o EventSource do navegador reconecta sozinho, então o
   * cliente decide se fecha (erro definitivo) ou deixa reconectar.
   */
  @Sse(':numero/stream')
  stream(@Param('numero') numero: string): Observable<EventoSse> {
    const linha$ = this.linhas.observar(numero).pipe(
      map((linha): EventoSse => ({ type: 'linha', data: linha })),
      catchError((e: unknown) => of<EventoSse>(paraEventoErro(e))),
    );
    // (comentário, e não evento com `data` numérico: o SseStream do Nest só
    // serializa string/objeto e derrubaria o fluxo inteiro)
    const ping$ = interval(config.ssePingMs).pipe(
      map((): EventoSse => ({ comment: 'ping' })),
    );
    // Depois de um erro, encerra (o `true` deixa o próprio evento passar).
    return merge(linha$, ping$).pipe(
      takeWhile((e) => !('type' in e) || e.type !== 'erro', true),
    );
  }
}

function paraEventoErro(e: unknown): EventoSse {
  const status = e instanceof HttpException ? e.getStatus() : 500;
  const message =
    e instanceof HttpException ? e.message : 'Erro interno ao obter a linha';
  return { type: 'erro', data: { status, message }, retry: 5_000 };
}
