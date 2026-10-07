import { Injectable, effect, signal } from '@angular/core';

export type Tema = 'dia' | 'noite';

const CHAVE = 'onibus-natal:tema';
/** Cor da barra do sistema: o verde das placas nos dois temas. */
const COR_BARRA = '#00653a';

/**
 * Tema inteiro (tokens de cor, mapa, barra do sistema), não só os tiles.
 * Começa pela preferência do aparelho; a escolha manual fica guardada.
 */
@Injectable({ providedIn: 'root' })
export class TemaService {
  readonly tema = signal<Tema>(inicial());

  constructor() {
    effect(() => {
      const tema = this.tema();
      const raiz = document.documentElement;
      raiz.dataset['tema'] = tema;
      raiz.style.colorScheme = tema === 'noite' ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COR_BARRA);
    });
  }

  alternar(): void {
    this.tema.update((t) => (t === 'dia' ? 'noite' : 'dia'));
    try {
      localStorage.setItem(CHAVE, this.tema());
    } catch {
      /* sem armazenamento: vale só nesta sessão */
    }
  }
}

function inicial(): Tema {
  try {
    const salvo = localStorage.getItem(CHAVE);
    if (salvo === 'dia' || salvo === 'noite') return salvo;
  } catch {
    /* ignora */
  }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'noite'
    : 'dia';
}
