import { Injectable, signal } from '@angular/core';

export interface Posicao {
  lat: number;
  lng: number;
  /** Precisão informada pelo aparelho (m). */
  precisao: number;
}

/** Posição do aparelho, pedida só quando o passageiro toca num botão. */
@Injectable({ providedIn: 'root' })
export class LocalizacaoService {
  readonly posicao = signal<Posicao | null>(null);
  readonly buscando = signal(false);

  /** Pede a posição. Devolve uma mensagem para o passageiro se não der. */
  pedir(): Promise<string | null> {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      return Promise.resolve('Este aparelho não informa a localização.');
    }
    this.buscando.set(true);
    return new Promise((resolve) =>
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          this.buscando.set(false);
          this.posicao.set({
            lat: coords.latitude,
            lng: coords.longitude,
            precisao: coords.accuracy,
          });
          resolve(null);
        },
        (e) => {
          this.buscando.set(false);
          resolve(
            e.code === e.PERMISSION_DENIED
              ? 'Localização bloqueada. Libere no navegador ou escolha o ponto na lista.'
              : e.code === e.TIMEOUT
                ? 'A localização demorou. Tente de novo ou escolha na lista.'
                : 'Não deu para achar você agora. Escolha o ponto na lista.',
          );
        },
        { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
      ),
    );
  }
}
