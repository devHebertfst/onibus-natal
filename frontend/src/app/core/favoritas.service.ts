import { Injectable, signal } from '@angular/core';

const MAX_RECENTES = 6;

/** Linhas favoritas e recentes, guardadas só neste navegador. */
@Injectable({ providedIn: 'root' })
export class FavoritasService {
  readonly favoritas = signal<string[]>(ler('onibus-natal:favoritas'));
  readonly recentes = signal<string[]>(ler('onibus-natal:recentes'));

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
}

const ordemNumerica = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { numeric: true });

// O armazenamento pode estar bloqueado (aba anônima, cookies desligados):
// nesse caso as favoritas só duram a sessão.
function ler(chave: string): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(chave) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function gravar(chave: string, valor: string[]): void {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* sem armazenamento: mantém só em memória */
  }
}
