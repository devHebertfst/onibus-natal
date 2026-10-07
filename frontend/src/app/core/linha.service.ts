import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, distinctUntilChanged, map, of, switchMap, timer } from 'rxjs';
import { Linha } from './linha.models';

/**
 * Consulta o cache do backend. Bater no backend é barato (ele responde da
 * memória), então perguntamos a cada 5s para pegar cada atualização do loop
 * de 15s com pouco atraso. Na fase 2 isso vira WebSocket (push).
 */
const INTERVALO_MS = 5_000;

export type Atualizacao =
  | { tipo: 'dados'; linha: Linha; recebidoEm: number }
  | { tipo: 'erro'; mensagem: string; fatal: boolean };

@Injectable({ providedIn: 'root' })
export class LinhaService {
  private readonly http = inject(HttpClient);

  buscar(numero: string): Observable<Linha> {
    return this.http.get<Linha>(`/api/linhas/${encodeURIComponent(numero)}`);
  }

  /** Emite a linha sempre que o backend tiver dados novos (e erros, sem parar). */
  acompanhar(numero: string): Observable<Atualizacao> {
    return timer(0, INTERVALO_MS).pipe(
      switchMap(() =>
        this.buscar(numero).pipe(
          map((linha): Atualizacao => ({ tipo: 'dados', linha, recebidoEm: Date.now() })),
          catchError((e: HttpErrorResponse) => of<Atualizacao>(paraErro(e))),
        ),
      ),
      distinctUntilChanged(
        (a, b) =>
          a.tipo === 'dados' && b.tipo === 'dados' && a.linha.atualizadoEm === b.linha.atualizadoEm,
      ),
    );
  }
}

function paraErro(e: HttpErrorResponse): Atualizacao {
  const mensagemBackend = typeof e.error?.message === 'string' ? e.error.message : null;
  switch (e.status) {
    case 0:
      return { tipo: 'erro', mensagem: 'Sem conexão com o servidor', fatal: false };
    case 400:
    case 404:
      return { tipo: 'erro', mensagem: mensagemBackend ?? 'Linha não encontrada', fatal: true };
    default:
      return { tipo: 'erro', mensagem: mensagemBackend ?? `Erro ${e.status}`, fatal: false };
  }
}
