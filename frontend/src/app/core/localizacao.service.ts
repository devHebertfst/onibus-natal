import { Injectable, signal } from '@angular/core';

export interface Posicao {
  lat: number;
  lng: number;
  /** Precisão informada pelo aparelho (m). */
  precisao: number;
}

/** Movimentos menores que isso (m) não atualizam a posição: é ruído do GPS. */
const MOVIMENTO_MIN_M = 2;
/** Uma posição mais nova que isso (ms) responde ao "onde estou" na hora. */
const RECENTE_MS = 10_000;

/**
 * Posição do aparelho, em tempo real.
 *
 * A permissão só é pedida quando o passageiro toca num botão ("perto de
 * mim", "mostrar onde estou"). Depois que ele permite (ou se já tinha
 * permitido antes), a posição passa a ser acompanhada continuamente, e o
 * ponto azul anda com ele no mapa. Com o app em segundo plano o
 * acompanhamento pausa, para poupar bateria.
 */
@Injectable({ providedIn: 'root' })
export class LocalizacaoService {
  readonly posicao = signal<Posicao | null>(null);
  readonly buscando = signal(false);

  private acompanhar = false;
  private watchId: number | null = null;
  private recebidaEm = 0;

  constructor() {
    if (!disponivel()) return;
    document.addEventListener('visibilitychange', () => this.ajustar());
    // Permissão já dada antes: acompanha desde a abertura, sem perguntar nada.
    navigator.permissions
      ?.query({ name: 'geolocation' as PermissionName })
      .then((estado) => {
        if (estado.state === 'granted') this.iniciar();
        estado.onchange = () => (estado.state === 'granted' ? this.iniciar() : this.parar());
      })
      .catch(() => {
        // Sem Permissions API (navegadores antigos): só depois do 1º pedido.
      });
  }

  /** Pede a posição. Devolve uma mensagem para o passageiro se não der. */
  pedir(): Promise<string | null> {
    if (!disponivel()) {
      return Promise.resolve('Este aparelho não informa a localização.');
    }
    // Já acompanhando, com posição fresca: responde na hora.
    if (this.watchId !== null && this.posicao() && Date.now() - this.recebidaEm < RECENTE_MS) {
      return Promise.resolve(null);
    }
    this.buscando.set(true);
    return new Promise((resolve) =>
      navigator.geolocation.getCurrentPosition(
        (p) => {
          this.buscando.set(false);
          this.receber(p, true);
          this.iniciar();
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

  private iniciar(): void {
    this.acompanhar = true;
    this.ajustar();
  }

  private parar(): void {
    this.acompanhar = false;
    this.ajustar();
  }

  /** Liga o acompanhamento com o app à vista e desliga em segundo plano. */
  private ajustar(): void {
    const ligar = this.acompanhar && document.visibilityState === 'visible';
    if (ligar && this.watchId === null) {
      this.watchId = navigator.geolocation.watchPosition(
        (p) => this.receber(p),
        (e) => {
          // Sem permissão, para; outras falhas são passageiras: fica a última posição.
          if (e.code === e.PERMISSION_DENIED) this.parar();
        },
        { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
      );
    } else if (!ligar && this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  private receber({ coords }: GeolocationPosition, sempre = false): void {
    this.recebidaEm = Date.now();
    const nova = { lat: coords.latitude, lng: coords.longitude, precisao: coords.accuracy };
    const atual = this.posicao();
    if (
      !sempre &&
      atual &&
      distanciaM(atual, nova) < MOVIMENTO_MIN_M &&
      Math.abs(atual.precisao - nova.precisao) < 5
    )
      return;
    this.posicao.set(nova);
  }
}

function disponivel(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

function distanciaM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const kx = 111_195 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((b.lng - a.lng) * kx, (b.lat - a.lat) * 111_195);
}
