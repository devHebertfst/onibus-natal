import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { LinhaService } from './core/linha.service';
import { CORES, DadosMapa, Mapa } from './mapa/mapa';

@Component({
  selector: 'app-root',
  imports: [Mapa, DatePipe],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly linhaService = inject(LinhaService);
  private readonly mapa = viewChild.required(Mapa);
  private assinatura?: Subscription;

  protected readonly numero = signal<string | null>(null);
  protected readonly dados = signal<DadosMapa | null>(null);
  protected readonly erro = signal<string | null>(null);
  protected readonly carregando = signal(false);

  protected readonly linha = computed(() => this.dados()?.linha ?? null);
  protected readonly itinerarios = computed(() =>
    (this.linha()?.itinerarios ?? []).map((it, i) => ({ ...it, cor: CORES[i % CORES.length] })),
  );
  protected readonly onibus = computed(() => this.linha()?.onibus ?? []);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.assinatura?.unsubscribe());
    const inicial = new URLSearchParams(location.search).get('linha');
    if (inicial) this.acompanhar(inicial);
  }

  protected acompanhar(valor: string): void {
    const numero = valor.trim().toUpperCase();
    if (!numero || numero === this.numero()) return;

    this.assinatura?.unsubscribe();
    this.numero.set(numero);
    this.dados.set(null);
    this.erro.set(null);
    this.carregando.set(true);
    history.replaceState(null, '', `?linha=${encodeURIComponent(numero)}`);

    this.assinatura = this.linhaService.acompanhar(numero).subscribe((a) => {
      this.carregando.set(false);
      if (a.tipo === 'dados') {
        this.erro.set(null);
        this.dados.set({ linha: a.linha, recebidoEm: a.recebidoEm });
      } else {
        this.erro.set(a.mensagem);
        if (a.fatal) {
          this.assinatura?.unsubscribe();
          this.numero.set(null);
        }
      }
    });
  }

  protected focar(id: string): void {
    this.mapa().focar(id);
  }

  protected corDoOnibus(itinerarios: string[]): string {
    const its = this.itinerarios();
    const unico = itinerarios.length === 1 ? its.find((i) => i.codigo === itinerarios[0]) : null;
    return unico?.cor ?? '#616161';
  }
}
