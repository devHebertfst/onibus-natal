import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Linha } from './linha.models';

/** Estado da conexão de streaming com o backend. */
export type StatusConexao = 'conectando' | 'ao-vivo' | 'reconectando';

export type Atualizacao =
  | { tipo: 'dados'; linha: Linha; recebidoEm: number }
  | { tipo: 'status'; status: StatusConexao }
  | { tipo: 'erro'; mensagem: string; fatal: boolean };

/**
 * Recebe as atualizações de uma linha por Server-Sent Events: o backend
 * empurra cada snapshot assim que o loop dele busca a API de transporte, sem
 * o navegador ficar perguntando. O EventSource reconecta sozinho se a conexão
 * cair; só erros definitivos (linha inexistente) encerram o fluxo.
 */
@Injectable({ providedIn: 'root' })
export class LinhaService {
  acompanhar(numero: string): Observable<Atualizacao> {
    return new Observable<Atualizacao>((obs) => {
      const fonte = new EventSource(`/api/linhas/${encodeURIComponent(numero)}/stream`);
      obs.next({ tipo: 'status', status: 'conectando' });

      fonte.onopen = () => obs.next({ tipo: 'status', status: 'ao-vivo' });
      fonte.addEventListener('linha', (ev) => {
        const linha = JSON.parse((ev as MessageEvent<string>).data) as Linha;
        obs.next({ tipo: 'dados', linha, recebidoEm: Date.now() });
      });
      // Evento do backend (não confundir com `error`, que é da conexão).
      fonte.addEventListener('erro', (ev) => {
        const { status, message } = JSON.parse((ev as MessageEvent<string>).data) as {
          status: number;
          message: string;
        };
        const fatal = status === 400 || status === 404;
        obs.next({ tipo: 'erro', mensagem: message, fatal });
        if (fatal) fonte.close();
      });
      fonte.onerror = () => {
        if (fonte.readyState === EventSource.CONNECTING)
          obs.next({ tipo: 'status', status: 'reconectando' });
      };

      return () => fonte.close();
    });
  }
}
