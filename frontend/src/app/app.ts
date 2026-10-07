import { DecimalPipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { FavoritasService } from './core/favoritas.service';
import { LinhaService, StatusConexao } from './core/linha.service';
import { Previsao } from './mapa/dead-reckoning/previsao';
import { CORES, COR_SEM_ROTA, DadosMapa, EstiloMapa, Mapa, ParadaSelecionada } from './mapa/mapa';

type Aba = 'linha' | 'favoritas';

interface IndicadorStatus {
  rotulo: string;
  tipo: 'vivo' | 'alerta' | 'neutro';
}

@Component({
  selector: 'app-root',
  imports: [Mapa, DecimalPipe],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: { '(document:keydown)': 'tecla($event)' },
})
export class App {
  private readonly linhaService = inject(LinhaService);
  protected readonly fav = inject(FavoritasService);
  private readonly mapa = viewChild.required(Mapa);
  private readonly campo = viewChild.required<ElementRef<HTMLInputElement>>('campo');
  private assinatura?: Subscription;
  private timerAviso?: ReturnType<typeof setTimeout>;

  protected readonly numero = signal<string | null>(null);
  protected readonly dados = signal<DadosMapa | null>(null);
  protected readonly erro = signal<string | null>(null);
  protected readonly carregando = signal(false);
  protected readonly status = signal<StatusConexao | null>(null);
  protected readonly aba = signal<Aba>('linha');
  /** No celular o painel começa recolhido para o mapa aparecer. */
  protected readonly painelAberto = signal(
    !(typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches),
  );
  protected readonly selecionado = signal<string | null>(null);
  protected readonly paradaSel = signal<ParadaSelecionada | null>(null);
  protected readonly estilo = signal<EstiloMapa>('escuro');
  protected readonly aviso = signal<string | null>(null);
  /** Relógio de 1 s para "há X s", sentidos e previsões. */
  protected readonly agora = signal(Date.now());
  private readonly sentidos = signal(new Map<string, string | null>());
  protected readonly previsoes = signal<Previsao[]>([]);

  protected readonly linha = computed(() => this.dados()?.linha ?? null);
  protected readonly itinerarios = computed(() =>
    (this.linha()?.itinerarios ?? []).map((it, i) => ({ ...it, cor: CORES[i % CORES.length] })),
  );
  protected readonly favorita = computed(() => {
    const n = this.numero();
    return n !== null && this.fav.favoritas().includes(n);
  });

  protected readonly onibus = computed(() => {
    const its = this.itinerarios();
    const sentidos = this.sentidos();
    const agora = this.agora();
    return (this.linha()?.onibus ?? []).map((o) => {
      // Sentido inferido no mapa; sem ele, o itinerário da API se for único.
      const codigo = sentidos.get(o.id) ?? (o.itinerarios.length === 1 ? o.itinerarios[0] : null);
      const it = its.find((i) => i.codigo === codigo);
      const paradoMin =
        o.velocidadeKmh === 0 ? Math.floor((agora - Date.parse(o.posicaoDesde)) / 60_000) : null;
      return {
        ...o,
        cor: it?.cor ?? COR_SEM_ROTA,
        sentido: it ? sentidoCurto(it.descricao) || it.codigo : 'sentido indefinido',
        paradoMin,
      };
    });
  });

  protected readonly emMovimento = computed(
    () => this.onibus().filter((o) => (o.velocidadeKmh ?? 0) > 0).length,
  );

  /** Ônibus cuja velocidade o backend ainda está calculando (linha recém-aberta). */
  protected readonly calculando = computed(
    () => this.onibus().filter((o) => o.velocidadeKmh === null).length,
  );

  protected readonly idadeS = computed(() => {
    const d = this.dados();
    return d ? Math.max(0, Math.round((this.agora() - d.recebidoEm) / 1000)) : null;
  });

  protected readonly indicador = computed((): IndicadorStatus | null => {
    if (!this.numero()) return null;
    switch (this.status()) {
      case 'conectando':
        return { rotulo: 'conectando', tipo: 'neutro' };
      case 'reconectando':
        return { rotulo: 'reconectando', tipo: 'alerta' };
      case 'ao-vivo':
        return this.linha()?.desatualizado
          ? { rotulo: 'atrasado', tipo: 'alerta' }
          : { rotulo: 'ao vivo', tipo: 'vivo' };
      default:
        return null;
    }
  });

  protected readonly paradaInfo = computed(() => {
    const sel = this.paradaSel();
    if (!sel) return null;
    const it = this.itinerarios().find((i) => i.codigo === sel.itinerario);
    return { ...sel, cor: it?.cor ?? COR_SEM_ROTA, sentido: it ? sentidoCurto(it.descricao) : '' };
  });

  constructor() {
    const relogio = setInterval(() => this.tique(), 1000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(relogio);
      this.assinatura?.unsubscribe();
    });
    afterNextRender(() => document.getElementById('splash')?.classList.add('oculto'));

    const params = new URLSearchParams(location.search);
    if (params.get('painel') === 'favoritas') this.aba.set('favoritas');
    const inicial = params.get('linha');
    if (inicial) this.acompanhar(inicial);
  }

  protected acompanhar(valor: string): void {
    const numero = valor.trim().toUpperCase();
    if (!numero) return;
    this.aba.set('linha');
    if (numero === this.numero()) return;

    this.assinatura?.unsubscribe();
    this.numero.set(numero);
    this.dados.set(null);
    this.erro.set(null);
    this.status.set(null);
    this.selecionado.set(null);
    this.paradaSel.set(null);
    this.carregando.set(true);
    history.replaceState(null, '', `?linha=${encodeURIComponent(numero)}`);

    this.assinatura = this.linhaService.acompanhar(numero).subscribe((a) => {
      switch (a.tipo) {
        case 'status':
          this.status.set(a.status);
          break;
        case 'dados':
          this.carregando.set(false);
          this.erro.set(null);
          this.status.set('ao-vivo');
          if (this.dados() === null) this.fav.registrarRecente(numero);
          this.dados.set({ linha: a.linha, recebidoEm: a.recebidoEm });
          break;
        case 'erro':
          this.carregando.set(false);
          this.erro.set(a.mensagem);
          if (a.fatal) {
            this.assinatura?.unsubscribe();
            this.numero.set(null);
            this.status.set(null);
            history.replaceState(null, '', location.pathname);
          }
      }
    });
  }

  protected fechar(): void {
    this.assinatura?.unsubscribe();
    this.numero.set(null);
    this.dados.set(null);
    this.erro.set(null);
    this.status.set(null);
    this.carregando.set(false);
    this.selecionado.set(null);
    this.paradaSel.set(null);
    this.campo().nativeElement.value = '';
    history.replaceState(null, '', location.pathname);
  }

  protected focar(id: string): void {
    this.selecionado.set(id);
    this.mapa().focar(id);
  }

  protected selecionarParada(sel: ParadaSelecionada): void {
    this.paradaSel.set(sel);
    this.previsoes.set(this.mapa().previsoes(sel));
  }

  protected enquadrar(): void {
    this.selecionado.set(null);
    this.mapa().enquadrar();
  }

  protected alternarEstilo(): void {
    this.estilo.update((e) => (e === 'escuro' ? 'claro' : 'escuro'));
  }

  protected async centralizarEmMim(): Promise<void> {
    const problema = await this.mapa().centralizarEmMim();
    if (problema) this.mostrarAviso(problema);
  }

  protected alternarFavorita(): void {
    const n = this.numero();
    if (n) this.fav.alternar(n);
  }

  protected tecla(e: KeyboardEvent): void {
    const digitando = (e.target as HTMLElement | null)?.tagName === 'INPUT';
    if (e.key === 'Escape') {
      if (this.paradaSel()) this.paradaSel.set(null);
      else if (this.selecionado()) this.selecionado.set(null);
      (document.activeElement as HTMLElement | null)?.blur();
    } else if (digitando || e.ctrlKey || e.metaKey || e.altKey) {
      return;
    } else if (e.key === '/') {
      e.preventDefault();
      this.painelAberto.set(true);
      this.campo().nativeElement.focus();
    } else if (e.key.toLowerCase() === 'r') {
      this.enquadrar();
    } else if (e.key.toLowerCase() === 'f') {
      this.alternarFavorita();
    }
  }

  private tique(): void {
    this.agora.set(Date.now());
    if (!this.dados()) return;
    this.sentidos.set(this.mapa().sentidos());
    const sel = this.paradaSel();
    if (sel) this.previsoes.set(this.mapa().previsoes(sel));
  }

  private mostrarAviso(texto: string): void {
    clearTimeout(this.timerAviso);
    this.aviso.set(texto);
    this.timerAviso = setTimeout(() => this.aviso.set(null), 4000);
  }
}

/** "33 - CIDADE NOVA / RIBEIRA (IDA)" → parte depois do número da linha. */
function sentidoCurto(descricao: string): string {
  return descricao.replace(/^\s*[\w-]+\s*[-–:]\s*/, '').trim() || descricao.trim();
}
