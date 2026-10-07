import { Injectable, signal } from '@angular/core';

const MAX_RECENTES = 6;

/** Linhas favoritas, recentes e o "meu ponto" de cada linha, guardados só neste navegador. */
@Injectable({ providedIn: 'root' })
export class FavoritasService {
  readonly favoritas = signal<string[]>(lerLista('onibus-natal:favoritas'));
  readonly recentes = signal<string[]>(lerLista('onibus-natal:recentes'));
  /** Linha → chave do ponto salvo (`itinerario|codigo`). */
  readonly meusPontos = signal<Record<string, string>>(lerMapa('onibus-natal:meus-pontos'));

  eFavorita(numero: string): boolean {
    return this.favoritas().includes(numero);
  }

  alternar(numero: string): void {
    this.favoritas.update((l) =>
      l.includes(numero) ? l.filter((n) => n !== numero) : [...l, numero].sort(ordemNumerica),
    );
    gravar('onibus-natal:favoritas', this.favoritas());
  }

  registrarRecente(numero: string): void {
    this.recentes.update((l) => [numero, ...l.filter((n) => n !== numero)].slice(0, MAX_RECENTES));
    gravar('onibus-natal:recentes', this.recentes());
  }

  meuPonto(numero: string): string | null {
    return this.meusPontos()[numero] ?? null;
  }

  /** Salva (ou, com `null`, esquece) o ponto do passageiro nesta linha. */
  definirMeuPonto(numero: string, chave: string | null): void {
    this.meusPontos.update((m) => {
      const novo = { ...m };
      if (chave) novo[numero] = chave;
      else delete novo[numero];
      return novo;
    });
    gravar('onibus-natal:meus-pontos', this.meusPontos());
  }
}

const ordemNumerica = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { numeric: true });

// O armazenamento pode estar bloqueado (aba anônima, cookies desligados):
// nesse caso tudo dura só a sessão.
function lerLista(chave: string): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(chave) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function lerMapa(chave: string): Record<string, string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(chave) ?? '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(
      Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string'),
    );
  } catch {
    return {};
  }
}

function gravar(chave: string, valor: unknown): void {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* sem armazenamento: mantém só em memória */
  }
}
