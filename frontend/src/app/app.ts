import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { FavoritasService } from './core/favoritas.service';
import { LinhaService, StatusConexao } from './core/linha.service';
import { LocalizacaoService } from './core/localizacao.service';
import { PontoFisico, acharPonto, agruparParadas, pontosProximos } from './core/pontos';
import { TemaService } from './core/tema.service';
import { destino, distanciaTexto } from './core/texto';
import { COR_SEM_ROTA, DadosMapa, Mapa, corDoSentido } from './mapa/mapa';
import { Placa, SentidoNaPlaca } from './placa/placa';

/** Alturas da gaveta no celular. */
type Gaveta = 'baixa' | 'media' | 'alta';

interface IndicadorStatus {
  rotulo: string;
  tipo: 'vivo' | 'alerta' | 'neutro';
}

/** Ônibus que a placa segue num sentido, e quanto faltava na última vez. */
interface Seguido {
  onibus: string;
  minutos: number;
}

/** Por quanto tempo a placa explica por que o número mudou. */
const AVISO_PLACA_MS = 45_000;

@Component({
  selector: 'app-root',
  imports: [Mapa, Placa],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: { '(document:keydown)': 'tecla($event)' },
})
export class App {
  private readonly linhaService = inject(LinhaService);
  protected readonly fav = inject(FavoritasService);
  protected readonly local = inject(LocalizacaoService);
  protected readonly temaService = inject(TemaService);
  private readonly mapa = viewChild.required(Mapa);
  private readonly campo = viewChild.required<ElementRef<HTMLInputElement>>('campo');
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;
  private alturaBaixaPx = 0;
  private assinatura?: Subscription;
  private timerAviso?: ReturnType<typeof setTimeout>;
  /** Parada pedida no link (`?parada=`), aplicada quando a linha chegar. */
  private paradaPendente: string | null = null;

  protected readonly numero = signal<string | null>(null);
  protected readonly dados = signal<DadosMapa | null>(null);
  protected readonly erro = signal<string | null>(null);
  protected readonly carregando = signal(false);
  protected readonly status = signal<StatusConexao | null>(null);
  /** Na tela inicial a gaveta começa baixa: o mapa aparece e o campo fica à mão. */
  protected readonly gaveta = signal<Gaveta>('baixa');
  /** Texto do campo da linha (não é apagado quando a linha não existe). */
  protected readonly valorCampo = signal('');
  protected readonly offline = signal(
    typeof navigator !== 'undefined' && navigator.onLine === false,
  );
  protected readonly selecionado = signal<string | null>(null);
  /** Chave do ponto físico escolhido. */
  protected readonly pontoSel = signal<string | null>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly avisoLocal = signal<string | null>(null);
  /** Texto para o leitor de tela: só mudanças de verdade, nunca a cada segundo. */
  protected readonly anuncio = signal('');
  /** "Chegando" interrompe o leitor de tela; vai numa região própria, que nada sobrescreve. */
  protected readonly anuncioUrgente = signal('');
  protected readonly filtroParadas = signal('');
  protected readonly listaAberta = signal(false);
  /** Frota aberta ou fechada pelo passageiro; sem escolha, fica fechada quando há placa. */
  protected readonly frotaEscolha = signal<boolean | null>(null);
  /** Relógio de 1 s para "há X s", sentidos e previsões. */
  protected readonly agora = signal(Date.now());
  private readonly sentidos = signal(new Map<string, string | null>());
  protected readonly sentidosPlaca = signal<SentidoNaPlaca[]>([]);
  private chegandoAnunciado = new Set<string>();
  /** Itinerário → ônibus que a placa está seguindo. */
  private seguidos = new Map<string, Seguido>();
  /** Itinerário → explicação de por que o ônibus seguido mudou. */
  private avisosPlaca = new Map<string, { texto: string; ate: number }>();
  /** Fim do último toque na alça: o `click` que vem logo depois não pode alternar de novo. */
  private fimToqueAlca = 0;

  protected readonly tema = this.temaService.tema;
  protected readonly corSemRota = COR_SEM_ROTA;
  protected readonly linha = computed(() => this.dados()?.linha ?? null);
  protected readonly itinerarios = computed(() =>
    (this.linha()?.itinerarios ?? []).map((it, i) => ({
      ...it,
      cor: corDoSentido(i, this.tema()),
      destino: destino(it.descricao) || it.codigo,
    })),
  );
  protected readonly pontos = computed(() => agruparParadas(this.linha()?.itinerarios ?? []));
  protected readonly ponto = computed(() => {
    const chave = this.pontoSel();
    return chave ? (this.pontos().find((p) => p.chave === chave) ?? null) : null;
  });
  protected readonly ehMeuPonto = computed(() => {
    const n = this.numero();
    const p = this.ponto();
    return !!n && !!p && this.fav.meusPontos()[n] === p.chave;
  });
  protected readonly favorita = computed(() => {
    const n = this.numero();
    return n !== null && this.fav.favoritas().includes(n);
  });
  protected readonly frotaAberta = computed(() => this.frotaEscolha() ?? !this.ponto());
  /** Recentes que não estão nas favoritas (as favoritas já aparecem logo acima). */
  protected readonly recentes = computed(() => {
    const favs = this.fav.favoritas();
    return this.fav.recentes().filter((n) => !favs.includes(n));
  });
  /** "Ver" só quando o campo pede outra linha; com a linha já aberta, sobra o ✕. */
  protected readonly mostrarVer = computed(() => {
    const digitado = this.valorCampo().trim().toUpperCase();
    return digitado !== '' && digitado !== this.numero();
  });

  /** Tempo até o ponto escolhido de cada ônibus (o menor entre os sentidos). */
  private readonly etas = computed(() => {
    const etas = new Map<string, number>();
    for (const s of this.sentidosPlaca())
      for (const p of s.previsoes)
        etas.set(p.onibus, Math.min(p.minutos, etas.get(p.onibus) ?? Infinity));
    return etas;
  });

  /** Rótulos do mapa: só os ônibus que a placa segue, com o tempo até o ponto. */
  protected readonly rotulosMapa = computed(() => {
    const rotulos: Record<string, string> = {};
    for (const s of this.sentidosPlaca()) {
      const p = s.previsoes[0];
      if (p) rotulos[p.onibus] = p.minutos < 1 ? 'chegando' : `${Math.round(p.minutos)} min`;
    }
    return rotulos;
  });

  protected readonly proximos = computed(() => {
    const pos = this.local.posicao();
    if (!pos) return [];
    return pontosProximos(this.pontos(), pos.lat, pos.lng).map((p) => ({
      ...p,
      distancia: distanciaTexto(p.metros),
      destinos: this.destinosDoPonto(p.ponto),
    }));
  });

  protected readonly paradasFiltradas = computed(() => {
    const termo = normalizar(this.filtroParadas());
    return this.pontos()
      .filter((p) => !termo || normalizar(p.nome).includes(termo))
      .map((p) => ({ ponto: p, destinos: this.destinosDoPonto(p) }));
  });

  protected readonly onibus = computed(() => {
    const its = this.itinerarios();
    const sentidos = this.sentidos();
    const agora = this.agora();
    const etas = this.etas();
    const lista = (this.linha()?.onibus ?? []).map((o) => {
      // O mapa decide o sentido (inferido ou, sem ele, o único da API): mesma cor nos dois.
      const codigo = sentidos.get(o.id) ?? (o.itinerarios.length === 1 ? o.itinerarios[0] : null);
      const it = its.find((i) => i.codigo === codigo);
      const paradoMin =
        o.velocidadeKmh === 0 ? Math.floor((agora - Date.parse(o.posicaoDesde)) / 60_000) : null;
      const eta = etas.get(o.id);
      return {
        ...o,
        cor: it?.cor ?? COR_SEM_ROTA,
        destino: it?.destino ?? null,
        paradoMin,
        chegaEm:
          eta === undefined ? null : eta < 1 ? 'chegando' : `chega em ${Math.round(eta)} min`,
        eta: eta ?? Infinity,
      };
    });
    // Com um ponto escolhido, primeiro os que vêm para ele, do mais perto ao mais longe.
    return lista.sort(
      (a, b) => a.eta - b.eta || a.id.localeCompare(b.id, 'pt-BR', { numeric: true }),
    );
  });

  protected readonly emMovimento = computed(
    () => this.onibus().filter((o) => (o.velocidadeKmh ?? 0) > 0).length,
  );

  protected readonly resumo = computed(() => {
    const total = this.onibus().length;
    if (total === 0) return 'Nenhum ônibus com GPS ligado nesta linha agora.';
    return `${total} ônibus na rua, ${this.emMovimento()} em movimento`;
  });

  /** Ônibus cuja velocidade o backend ainda está calculando (linha recém-aberta). */
  protected readonly calculando = computed(
    () => this.onibus().filter((o) => o.velocidadeKmh === null).length,
  );

  protected readonly idadeS = computed(() => {
    const d = this.dados();
    return d ? Math.max(0, Math.round((this.agora() - d.recebidoEm) / 1000)) : null;
  });

  // Igual por rótulo e tipo: a idade muda a cada segundo, o estado não.
  protected readonly indicador = computed(
    (): IndicadorStatus | null => {
      if (!this.numero()) return null;
      if (this.offline()) return { rotulo: 'Sem internet', tipo: 'alerta' };
      // O servidor manda dados a cada ~15 s; passado de 1 min, avisa.
      const idade = this.idadeS();
      if (this.status() === 'ao-vivo' && idade !== null && idade > 60)
        return { rotulo: 'Sem dados novos', tipo: 'alerta' };
      switch (this.status()) {
        case 'conectando':
          return { rotulo: 'Conectando', tipo: 'neutro' };
        case 'reconectando':
          return { rotulo: 'Reconectando', tipo: 'alerta' };
        case 'ao-vivo':
          return this.linha()?.desatualizado
            ? { rotulo: 'Dados atrasados', tipo: 'alerta' }
            : { rotulo: 'Ao vivo', tipo: 'vivo' };
        default:
          return null;
      }
    },
    { equal: (a, b) => a?.rotulo === b?.rotulo && a?.tipo === b?.tipo },
  );

  constructor() {
    const relogio = setInterval(() => this.tique(), 1000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(relogio);
      this.assinatura?.unsubscribe();
    });
    afterNextRender(() => document.getElementById('splash')?.classList.add('oculto'));

    // Anuncia só as transições do estado da conexão.
    effect(() => {
      const ind = this.indicador();
      if (ind && ind.tipo !== 'neutro') untracked(() => this.anuncio.set(ind.rotulo));
    });

    // Aplica o ponto pedido no link, ou o "meu ponto" salvo, quando a linha chega.
    effect(() => {
      const pontos = this.pontos();
      const n = this.numero();
      if (!n || pontos.length === 0) return;
      untracked(() => {
        if (this.ponto()) return;
        const ref = this.paradaPendente ?? this.fav.meuPonto(n);
        this.paradaPendente = null;
        const p = ref ? acharPonto(pontos, ref) : undefined;
        // Depois do mapa aplicar os dados, para enquadrar o ponto com o próximo ônibus.
        if (p) setTimeout(() => this.escolherPonto(p.chave));
      });
    });

    const conexao = () => this.offline.set(!navigator.onLine);
    addEventListener('online', conexao);
    addEventListener('offline', conexao);
    // Trocar de janela no meio do arrasto não pode deixar a gaveta presa.
    addEventListener('blur', () => (this.arrasto = null));
    inject(DestroyRef).onDestroy(() => {
      removeEventListener('online', conexao);
      removeEventListener('offline', conexao);
    });

    const params = new URLSearchParams(location.search);
    this.paradaPendente = params.get('parada');
    const inicial = params.get('linha');
    if (inicial) this.acompanhar(inicial);
    else if (params.get('painel') === 'favoritas') this.gaveta.set('alta');
  }

  protected acompanhar(valor: string): void {
    const numero = valor.trim().toUpperCase();
    if (!numero) return;
    if (numero === this.numero()) return;

    this.assinatura?.unsubscribe();
    this.numero.set(numero);
    this.valorCampo.set(numero);
    // A gaveta desce até o tamanho do conteúdo: o mapa é a prova, não pode sumir.
    this.gaveta.set('baixa');
    this.dados.set(null);
    this.erro.set(null);
    this.status.set(null);
    this.selecionado.set(null);
    this.pontoSel.set(null);
    this.sentidosPlaca.set([]);
    this.filtroParadas.set('');
    this.listaAberta.set(false);
    this.frotaEscolha.set(null);
    this.esquecerSeguidos();
    this.carregando.set(true);
    this.atualizarUrl();

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
          this.fav.registrarDestinos(
            numero,
            // "Planalto / Praia do Meio" + "Planalto / Mae Luiza" → "Planalto · Praia do Meio · Mae Luiza"
            [...new Set(this.itinerarios().flatMap((it) => it.destino.split(' / ')))].join(' · '),
          );
          break;
        case 'erro':
          this.carregando.set(false);
          this.erro.set(a.mensagem);
          if (a.fatal) {
            // Mantém o que foi digitado no campo para o passageiro corrigir.
            this.assinatura?.unsubscribe();
            this.numero.set(null);
            this.status.set(null);
            this.paradaPendente = null;
            this.atualizarUrl();
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
    this.pontoSel.set(null);
    this.sentidosPlaca.set([]);
    this.paradaPendente = null;
    this.valorCampo.set('');
    this.campo().nativeElement.value = '';
    this.atualizarUrl();
    this.campo().nativeElement.focus();
  }

  protected focar(id: string): void {
    this.selecionado.set(id);
    this.mapa().focar(id);
  }

  /** Escolhe o ponto do passageiro (pelo mapa, pela lista ou pelo link). */
  protected escolherPonto(chave: string, mover = true): void {
    const p = this.pontos().find((x) => x.chave === chave);
    if (!p) return;
    this.pontoSel.set(chave);
    this.chegandoAnunciado.clear();
    this.esquecerSeguidos();
    this.listaAberta.set(false);
    this.frotaEscolha.set(null);
    this.atualizarUrl();
    this.gaveta.set('baixa');
    this.tique();
    if (mover) {
      // Enquadra o ponto junto com o próximo ônibus a chegar, acima da gaveta.
      const proximo = this.sentidosPlaca()
        .map((s) => s.previsoes[0])
        .filter((x) => !!x)
        .sort((a, b) => a.minutos - b.minutos)[0];
      requestAnimationFrame(() => {
        this.medirGaveta();
        this.mapa().enquadrarPonto(p.lat, p.lng, proximo?.onibus ?? null, this.folgasMapa());
      });
    }
    this.anuncio.set(`Ponto escolhido: ${p.nome}`);
  }

  protected trocarPonto(): void {
    this.pontoSel.set(null);
    this.sentidosPlaca.set([]);
    this.esquecerSeguidos();
    this.frotaEscolha.set(null);
    this.atualizarUrl();
    // A pergunta substitui a placa: o foco vai para ela.
    requestAnimationFrame(() => this.host.querySelector<HTMLElement>('#titulo-seu-ponto')?.focus());
  }

  private esquecerSeguidos(): void {
    this.seguidos.clear();
    this.avisosPlaca.clear();
  }

  protected alternarMeuPonto(): void {
    const n = this.numero();
    const p = this.ponto();
    if (!n || !p) return;
    const salvar = !this.ehMeuPonto();
    this.fav.definirMeuPonto(n, salvar ? p.chave : null);
    this.mostrarAviso(
      salvar
        ? `Salvo. Na próxima vez que abrir a linha ${n}, este ponto aparece direto.`
        : `Pronto, a linha ${n} não abre mais neste ponto.`,
    );
  }

  protected async pertoDeMim(): Promise<void> {
    this.avisoLocal.set(null);
    const problema = await this.local.pedir();
    this.avisoLocal.set(problema);
    const pos = this.local.posicao();
    if (!problema && pos) {
      this.gaveta.set('media'); // mostra a lista de paradas que acabou de chegar
      // No mapa: você e as paradas mais próximas, acima da gaveta.
      const pontos: [number, number][] = [
        [pos.lat, pos.lng],
        ...this.proximos().map((p): [number, number] => [p.ponto.lat, p.ponto.lng]),
      ];
      requestAnimationFrame(() => this.mapa().enquadrarVarios(pontos, this.folgasMapa('media')));
      this.anuncio.set(`${this.proximos().length} paradas perto de você`);
    }
  }

  protected async centralizarEmMim(): Promise<void> {
    const problema = await this.local.pedir();
    const pos = this.local.posicao();
    if (problema) this.mostrarAviso(problema);
    else if (pos) this.mapa().irPara(pos.lat, pos.lng);
  }

  protected enquadrar(): void {
    this.selecionado.set(null);
    this.mapa().enquadrar();
  }

  protected alternarFavorita(): void {
    const n = this.numero();
    if (!n) return;
    this.fav.alternar(n);
    this.anuncio.set(
      this.favorita() ? `Linha ${n} nas favoritas` : `Linha ${n} fora das favoritas`,
    );
  }

  /** No celular, o teclado cobre a base da tela: sobe a gaveta ao digitar. */
  protected aoFocarCampo(): void {
    if (celular()) this.gaveta.set('alta');
  }

  /** Clique na alça (teclado, leitor de tela); o toque já foi tratado pelo arrasto. */
  protected cliqueAlca(): void {
    if (performance.now() - this.fimToqueAlca < 600) return;
    this.ciclarGaveta();
  }

  /** Toque na alça: baixa → média → alta → baixa. */
  protected ciclarGaveta(): void {
    this.gaveta.update((g) => (g === 'baixa' ? 'media' : g === 'media' ? 'alta' : 'baixa'));
  }

  // ---- arrastar a alça da gaveta (celular) ----
  private arrasto: { id: number; y: number; inicio: Gaveta; moveu: boolean } | null = null;

  protected arrastoInicio(e: PointerEvent): void {
    if (this.arrasto) return; // um segundo dedo não assume o arrasto
    this.arrasto = { id: e.pointerId, y: e.clientY, inicio: this.gaveta(), moveu: false };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  protected arrastoMove(e: PointerEvent): void {
    if (!this.arrasto || e.pointerId !== this.arrasto.id) return;
    const dy = e.clientY - this.arrasto.y;
    if (Math.abs(dy) < 24) return;
    const ordem: Gaveta[] = ['baixa', 'media', 'alta'];
    const i = ordem.indexOf(this.arrasto.inicio) + (dy < 0 ? 1 : -1);
    this.gaveta.set(ordem[Math.max(0, Math.min(2, i))]);
    this.arrasto.moveu = true;
  }

  /** Fim do gesto. Um toque sem arrastar alterna a altura; um cancelamento só limpa. */
  protected arrastoFim(e: PointerEvent, cancelado = false): void {
    const a = this.arrasto;
    if (!a || e.pointerId !== a.id) return;
    this.arrasto = null;
    if (cancelado) return;
    this.fimToqueAlca = performance.now();
    if (!a.moveu) this.ciclarGaveta();
  }

  protected tecla(e: KeyboardEvent): void {
    const alvo = e.target as HTMLElement | null;
    const digitando = alvo?.tagName === 'INPUT';
    if (e.key === 'Escape') {
      if (this.listaAberta()) this.listaAberta.set(false);
      else if (this.selecionado()) this.selecionado.set(null);
      else if (this.pontoSel()) this.trocarPonto();
      if (digitando) alvo?.blur();
    } else if (digitando || e.ctrlKey || e.metaKey || e.altKey) {
      return;
    } else if (e.key === '/') {
      e.preventDefault();
      this.gaveta.set('media');
      this.campo().nativeElement.select();
    } else if (e.key.toLowerCase() === 'r') {
      this.enquadrar();
    } else if (e.key.toLowerCase() === 'f') {
      this.alternarFavorita();
    }
  }

  protected destinosDoPonto(p: PontoFisico): { destino: string; cor: string }[] {
    const its = this.itinerarios();
    return p.sentidos.map((s) => {
      const it = its.find((i) => i.codigo === s.itinerario);
      return { destino: it?.destino ?? s.itinerario, cor: it?.cor ?? COR_SEM_ROTA };
    });
  }

  /** Espaço que o painel e os controles ocupam por cima do mapa (px). */
  private folgasMapa(gaveta: Gaveta = 'baixa'): {
    topoEsq: [number, number];
    baseDir: [number, number];
  } {
    if (celular()) {
      const topo = this.host.querySelector('.topo')?.getBoundingClientRect().bottom ?? 60;
      const base = gaveta === 'baixa' ? this.alturaBaixaPx : innerHeight * 0.64;
      return { topoEsq: [24, topo + 24], baseDir: [64, base + 24] };
    }
    const painel = this.host.querySelector('.painel')?.getBoundingClientRect().right ?? 420;
    return { topoEsq: [painel + 32, 32], baseDir: [72, 32] };
  }

  /**
   * Altura da gaveta baixa no celular: até o fim da resposta (placa ou botão
   * de escolher o ponto), nem mais nem menos. Medida a cada segundo, que é
   * quando a placa pode mudar de tamanho.
   */
  private medirGaveta(): void {
    if (!celular()) return;
    const painel = this.host.querySelector<HTMLElement>('.painel');
    const ancora =
      painel?.querySelector('[data-ancora]') ?? painel?.querySelector('.conteudo > :last-child');
    if (!painel || !ancora) return;
    const bruto = ancora.getBoundingClientRect().bottom - painel.getBoundingClientRect().top + 16;
    const altura = Math.round(Math.max(150, Math.min(bruto, innerHeight * 0.6)));
    if (Math.abs(altura - this.alturaBaixaPx) < 3) return;
    this.alturaBaixaPx = altura;
    this.host.style.setProperty('--h-baixa', `${altura}px`);
  }

  private tique(): void {
    this.agora.set(Date.now());
    this.medirGaveta();
    if (!this.dados()) return;
    this.sentidos.set(this.mapa().sentidos());
    const p = this.ponto();
    if (!p) return;

    const its = this.itinerarios();
    const agora = Date.now();
    const sentidos = p.sentidos.map((s): SentidoNaPlaca => {
      const it = its.find((i) => i.codigo === s.itinerario);
      const previsoes = this.mapa().previsoes(s);
      return {
        itinerario: s.itinerario,
        destino: it?.destino ?? s.itinerario,
        cor: it?.cor ?? COR_SEM_ROTA,
        rumo: this.mapa().rumo(s),
        previsoes,
        aviso: this.acompanharSeguido(s.itinerario, previsoes, agora),
      };
    });
    this.sentidosPlaca.set(sentidos);

    // "Chegando" interrompe o leitor de tela, uma vez por ônibus.
    for (const s of sentidos) {
      const prox = s.previsoes[0];
      if (prox && prox.minutos < 1 && !this.chegandoAnunciado.has(prox.onibus)) {
        this.chegandoAnunciado.add(prox.onibus);
        this.anuncioUrgente.set(
          `Ônibus ${prox.onibus} chegando no seu ponto, sentido ${s.destino}`,
        );
      }
    }
  }

  /**
   * A placa segue um ônibus por sentido. Se ele some da conta (passou do
   * ponto, mudou de sentido, perdeu o GPS) ou outro aparece na frente, o
   * número muda, e a placa diz por quê em vez de trocar em silêncio.
   */
  private acompanharSeguido(
    itinerario: string,
    previsoes: { onibus: string; minutos: number }[],
    agora: number,
  ): string | null {
    const antes = this.seguidos.get(itinerario);
    const primeiro = previsoes[0];
    // Outro ônibus passar à frente só encurta a espera; o que precisa de explicação
    // é o seguido sumir da conta.
    if (
      antes &&
      primeiro?.onibus !== antes.onibus &&
      !previsoes.some((x) => x.onibus === antes.onibus)
    ) {
      const texto =
        antes.minutos < 2
          ? `O ônibus nº ${antes.onibus} já passou por aqui.`
          : `O ônibus nº ${antes.onibus} saiu da conta (mudou de sentido ou perdeu o GPS).`;
      this.avisosPlaca.set(itinerario, { texto, ate: agora + AVISO_PLACA_MS });
      this.anuncio.set(texto);
    }
    if (primeiro)
      this.seguidos.set(itinerario, { onibus: primeiro.onibus, minutos: primeiro.minutos });
    else this.seguidos.delete(itinerario);

    const aviso = this.avisosPlaca.get(itinerario);
    if (aviso && aviso.ate < agora) this.avisosPlaca.delete(itinerario);
    return aviso && aviso.ate >= agora ? aviso.texto : null;
  }

  private atualizarUrl(): void {
    const n = this.numero();
    const params = new URLSearchParams();
    if (n) params.set('linha', n);
    const p = this.ponto();
    if (n && p) params.set('parada', p.chave);
    const busca = params.toString();
    history.replaceState(null, '', busca ? `?${busca}` : location.pathname);
  }

  private mostrarAviso(texto: string): void {
    clearTimeout(this.timerAviso);
    this.aviso.set(texto);
    this.timerAviso = setTimeout(() => this.aviso.set(null), 4500);
  }
}

function celular(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches;
}

/** Sem acento e minúsculo, para a busca por nome de parada. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}
