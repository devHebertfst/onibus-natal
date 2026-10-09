import { Component, DestroyRef, inject, signal } from '@angular/core';
import { ResumoDiagnostico, diagnostico } from '../core/diagnostico';

interface AtrasoGps {
  amostras: number;
  medianaS: number | null;
  p90S: number | null;
  aplicadoS: number;
}

/**
 * Painel de precisão (`?debug=1`): para conferir com a API real se o app
 * está atrasado ou adiantado, e quanto o atraso do GPS está sendo descontado.
 */
@Component({
  selector: 'app-painel-diagnostico',
  template: `
    <section class="diag" aria-label="Diagnóstico de precisão">
      <h2>Precisão</h2>
      @if (local(); as d) {
        <dl>
          <dt>Desenho × GPS ({{ d.desenho.amostras }})</dt>
          <dd>
            @if (d.desenho.medianaM === null) {
              sem amostras
            } @else {
              {{ d.desenho.medianaM }} m · {{ d.desenho.medianaS ?? '–' }} s ·
              {{ d.desenho.atrasPct }}% atrás
            }
          </dd>
          <dt>Nossa − Nubus ({{ d.comparacao.amostras }})</dt>
          <dd>
            @if (d.comparacao.medianaMin === null) {
              sem amostras
            } @else {
              mediana {{ d.comparacao.medianaMin }} min · média abs.
              {{ d.comparacao.mediaAbsMin }} min
            }
          </dd>
        </dl>
      }
      @if (gps(); as g) {
        <dl>
          <dt>Atraso do GPS ({{ g.amostras }})</dt>
          <dd>
            descontado {{ g.aplicadoS }} s
            @if (g.medianaS !== null) {
              · mediana {{ g.medianaS }} s · p90 {{ g.p90S }} s
            }
          </dd>
        </dl>
      }
      <p>Negativo = desenho atrás do real; positivo na comparação = a nossa diz mais tarde.</p>
    </section>
  `,
  styles: `
    .diag {
      position: fixed;
      z-index: 1500;
      left: 12px;
      top: 50%;
      width: 260px;
      padding: 10px 12px;
      border-radius: var(--raio);
      background: var(--texto);
      color: var(--chao);
      font-size: 13px;
      line-height: 1.35;
      font-variant-numeric: tabular-nums;
      box-shadow: var(--sombra);
      opacity: 0.94;
    }
    h2 {
      margin: 0 0 6px;
      font-size: 14px;
    }
    dl {
      margin: 0 0 6px;
    }
    dt {
      font-weight: 700;
    }
    dd {
      margin: 0 0 4px;
    }
    p {
      margin: 0;
      font-size: 12px;
      opacity: 0.8;
    }
  `,
})
export class PainelDiagnostico {
  protected readonly local = signal<ResumoDiagnostico>(diagnostico.resumo());
  protected readonly gps = signal<AtrasoGps | null>(null);

  constructor() {
    const atualizarLocal = setInterval(() => this.local.set(diagnostico.resumo()), 2_000);
    const atualizarGps = setInterval(() => this.buscarGps(), 15_000);
    this.buscarGps();
    inject(DestroyRef).onDestroy(() => {
      clearInterval(atualizarLocal);
      clearInterval(atualizarGps);
    });
  }

  private async buscarGps(): Promise<void> {
    try {
      const r = await fetch('/api/diagnostico');
      if (r.ok) this.gps.set(((await r.json()) as { atrasoGps: AtrasoGps }).atrasoGps);
    } catch {
      /* sem backend: mostra só o que o navegador mede */
    }
  }
}
