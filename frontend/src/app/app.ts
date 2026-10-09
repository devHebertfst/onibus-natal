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
import { NgTemplateOutlet } from '@angular/common';
import { Subscription } from 'rxjs';
import { FavoritasService } from './core/favoritas.service';
import { LinhaService, StatusConexao } from './core/linha.service';
import { LocalizacaoService } from './core/localizacao.service';
import { ParadaProxima, PrevisaoParada } from './core/paradas.models';
import { Oficial, horaLocal, mesclarPrevisoes } from './core/previsao-oficial';
import { PrevisaoService } from './core/previsao.service';
import { PontoFisico, acharPonto, agruparParadas, distanciaM, pontosProximos } from './core/pontos';
import { TemaService } from './core/tema.service';
import { destino, distanciaTexto, nomeParada } from './core/texto';
import { AreaMapa, COR_SEM_ROTA, DadosMapa, Mapa, corDoSentido } from './mapa/mapa';
import { Placa, SentidoNaPlaca } from './placa/placa';
import { LocalTrajeto, PontosTrajeto, TipoPontoTrajeto, Viagem } from './core/trajeto.models';
import { Planejador } from './planejador/planejador';
import { CatalogoService, LinhaCatalogo } from './core/catalogo.service';
import { Menu, MENUS, Navegacao } from './navegacao/navegacao';

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
/** Gaveta média no celular: fração da tela (igual a `46dvh` no CSS). */
const ALTURA_MEDIA = 0.46;
/** Abaixo deste zoom a tela inicial não busca paradas: seriam centenas de marcadores. */
const ZOOM_AREA = 14;

@Component({
  selector: 'app-root',
  imports: [Mapa, Placa, Planejador, Navegacao, NgTemplateOutlet],
  templateUrl: './app.html',
  styleUrls: ['./app.scss', './app-paineis.scss', './app-mapa-ui.scss', './app-catalogo.scss'],
  host: { '(document:keydown)': 'tecla($event)' },
})
export class App {
  private readonly linhaService = inject(LinhaService);
  private readonly previsaoService = inject(PrevisaoService);
  private readonly catalogoService = inject(CatalogoService);
  private consultaCatalogo?: AbortController;
  protected readonly catalogo = signal<LinhaCatalogo[]>([]);
  protected readonly carregandoCatalogo = signal(false);
  protected readonly erroCatalogo = signal<string | null>(null);
  protected readonly fav = inject(FavoritasService);
  protected readonly local = inject(LocalizacaoService);
  protected readonly temaService = inject(TemaService);
  private readonly mapa = viewChild.required(Mapa);
  private readonly planejador = viewChild(Planejador);
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
  /** Os menus abrem na metade da tela, para o mapa continuar à vista. */
  protected readonly gaveta = signal<Gaveta>('media');
  protected readonly menuAtual = signal<Menu>('linhas');
  /** No celular o app abre no mapa; o painel só sobe quando o passageiro pede. */
  protected readonly painelAberto = signal(!celular());
  protected readonly modoMapa = signal<'linha' | 'paradas' | 'trajeto'>('linha');
  protected readonly mostrarParadas = signal(true);
  protected readonly filtroPerto = signal('');
  private readonly rolagens = new Map<Menu, number>();
  private readonly alturas = new Map<Menu, Gaveta>();
  protected readonly iconeMenu = computed(
    () => MENUS.find((m) => m.id === this.menuAtual())!.icone,
  );
  protected readonly descricaoMenu = computed(
    () =>
      ({
        linhas: 'Escolha uma linha e acompanhe os ônibus',
        paradas: 'Paradas próximas e as linhas que passam por elas',
        trajetos: 'A pé e de ônibus · Natal',
        favoritas: 'Suas linhas de todo dia',
        ajustes: 'Mapa e informações do app',
      })[this.menuAtual()],
  );
  protected readonly tituloMenu = computed(
    () => MENUS.find((m) => m.id === this.menuAtual())!.nome,
  );
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
  protected readonly paradasLinhaAberta = signal(false);
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
  /** Itinerário → última previsão da Nubus para o ponto escolhido. */
  private readonly oficiais = new Map<string, Oficial>();
  protected readonly selecaoTrajeto = signal<TipoPontoTrajeto | null>(null);
  protected readonly pontosTrajeto = signal<PontosTrajeto>({ origem: null, destino: null });
  protected readonly viagemTrajeto = signal<Viagem | null>(null);

  /** Tela inicial: paradas com ônibus perto do passageiro (null = ainda não buscou). */
  protected readonly perto = signal<ParadaProxima[] | null>(null);
  protected readonly buscandoPerto = signal(false);
  protected readonly avisoPerto = signal<string | null>(null);
  /** Parada da lista "perto de você" tocada no mapa. */
  protected readonly paradaPertoSel = signal<string | null>(null);
  /** Previsão da parada escolhida na lista ou no mapa (sem linha aberta). */
  private readonly previsaoParada = signal<{
    codigo: string;
    dados: PrevisaoParada | null;
    falhou: boolean;
  } | null>(null);
  /** Tela inicial: paradas na parte visível do mapa. */
  protected readonly areaParadas = signal<ParadaProxima[]>([]);
  /** Mapa afastado demais para mostrar as paradas da tela inicial. */
  protected readonly longeDemais = signal(false);
  private ultimaArea: AreaMapa | null = null;
  private consultaArea?: AbortController;
  private timerArea?: ReturnType<typeof setTimeout>;

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
  /** Trajeto (pontos ou viagem) desenhado no mapa. */
  private readonly trajetoNoMapa = computed(() => {
    const { origem, destino } = this.pontosTrajeto();
    return this.modoMapa() === 'trajeto' && !!(this.viagemTrajeto() || origem || destino);
  });
  /** Nada aberto (linha, paradas perto, trajeto): o mapa mostra as paradas da área visível. */
  protected readonly mapaVazio = computed(
    () => !this.numero() && !this.perto()?.length && !this.trajetoNoMapa(),
  );
  /**
   * Paradas no mapa: as da linha aberta; sem linha, as perto do passageiro;
   * sem nada, as da parte visível do mapa.
   */
  protected readonly pontosMapa = computed((): PontoFisico[] => {
    if (this.linha() && this.modoMapa() !== 'paradas') return this.pontos();
    const perto = this.perto() ?? [];
    return (perto.length ? perto : this.mapaVazio() ? this.areaParadas() : []).map((p) => ({
      chave: p.codigo,
      nome: nomeParada(p.descricao) || 'Parada',
      lat: p.lat,
      lng: p.lng,
      sentidos: [],
    }));
  });
  protected readonly pertoLista = computed(() =>
    (this.perto() ?? []).map((p) => itemParada(p, distanciaTexto(p.metros))),
  );
  /** Parada da área visível tocada no mapa (fora da lista "perto de você"). */
  protected readonly paradaArea = computed(() => {
    const chave = this.paradaPertoSel();
    if (!chave || !this.mapaVazio()) return null;
    const p = this.areaParadas().find((x) => x.codigo === chave);
    if (!p) return null;
    // A distância que vem da área é até o centro do mapa; a que interessa é até o passageiro.
    const pos = this.local.posicao();
    return itemParada(p, pos ? distanciaTexto(distanciaM(pos.lat, pos.lng, p.lat, p.lng)) : null);
  });
  protected readonly pertoFiltradas = computed(() => {
    const termo = this.filtroPerto().trim().toLocaleLowerCase('pt-BR');
    return this.pertoLista().filter(
      (p) => !termo || p.nome.toLocaleLowerCase('pt-BR').includes(termo),
    );
  });
  /**
   * Próximos ônibus da parada escolhida, por sentido: até dois ao vivo
   * ("5 min", "12 min") ou, sem nenhum, o próximo horário da tabela.
   */
  protected readonly previsoesParada = computed(() => {
    const atual = this.previsaoParada();
    if (!atual || atual.codigo !== this.paradaPertoSel()) return null;
    if (!atual.dados) return { carregando: !atual.falhou, falhou: atual.falhou, linhas: [] };
    const agora = this.agora();
    const linhas = atual.dados.itinerarios.map((it) => {
      const futuras = (it.chegadas ?? []).filter((c) => Date.parse(c.chegaEm) > agora - 60_000);
      const aoVivo = futuras.filter((c) => c.aoVivo).slice(0, 2);
      const tempos = aoVivo.length
        ? aoVivo.map((c) => {
            const min = (Date.parse(c.chegaEm) - agora) / 60_000;
            return min < 1 ? 'chegando' : `${Math.round(min)} min`;
          })
        : [];
      const tabela = aoVivo.length ? null : futuras.find((c) => !c.aoVivo);
      return {
        numero: it.numero,
        destino: destino(it.descricao) || it.descricao || 'Linha ' + it.numero,
        tempos,
        tabela: tabela ? horaLocal(Date.parse(tabela.chegaEm)) : null,
        semResposta: it.chegadas === null,
        primeira: aoVivo.length ? Date.parse(aoVivo[0].chegaEm) : Infinity,
      };
    });
    linhas.sort((a, b) => a.primeira - b.primeira);
    return { carregando: false, falhou: false, linhas };
  });
  protected readonly onibusSelecionado = computed(
    () => this.onibus().find((o) => o.id === this.selecionado()) ?? null,
  );
  /** De onde vem o tempo da placa, para a nota embaixo dela dizer. */
  protected readonly fontePlaca = computed(() => {
    const fontes = new Set(this.sentidosPlaca().map((s) => s.fonte));
    return fontes.size > 1 ? 'misto' : fontes.has('nubus') ? 'nubus' : 'estimativa';
  });
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
  protected readonly linhasBusca = computed(() => {
    const conhecidas = new Map(this.catalogo().map((l) => [l.numero, l]));
    for (const numero of [
      ...this.fav.favoritas(),
      ...this.fav.recentes(),
      ...(this.numero() ? [this.numero()!] : []),
    ]) {
      if (!conhecidas.has(numero))
        conhecidas.set(numero, {
          numero,
          descricoes: this.fav.destinos()[numero] ? [this.fav.destinos()[numero]] : [],
        });
    }
    const termo = normalizar(this.valorCampo());
    return [...conhecidas.values()]
      .filter((l) => !termo || normalizar([l.numero, ...l.descricoes].join(' ')).includes(termo))
      .map((l) => {
        const descricao =
          (termo && l.descricoes.find((d) => normalizar(d).includes(termo))) ||
          l.descricoes.find((d) => d.includes('/')) ||
          l.descricoes[0];
        return { ...l, nome: descricao ? destino(descricao) : 'Linha ' + l.numero };
      })
      .sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
  });
  protected readonly numeroBusca = computed(() => {
    const valor = this.valorCampo()
      .trim()
      .toUpperCase()
      .replace(/^0+(?=\d)/, '');
    return /^(?=.*\d)[A-Z0-9.-]{1,10}$/.test(valor) ? valor : null;
  });
  protected readonly numeroEncontrado = computed(() =>
    this.linhasBusca().some((l) => l.numero === this.numeroBusca()),
  );

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
    void this.carregarCatalogo();
    const relogio = setInterval(() => this.tique(), 1000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(relogio);
      clearTimeout(this.timerArea);
      this.consultaArea?.abort();
      this.assinatura?.unsubscribe();
      this.consultaCatalogo?.abort();
    });
    afterNextRender(() => document.getElementById('splash')?.classList.add('oculto'));
    effect((aoLimpar) => {
      this.painelAberto();
      this.menuAtual();
      this.gaveta();
      this.selecionado();
      this.modoMapa();
      const frame = requestAnimationFrame(() => this.medirGaveta());
      aoLimpar(() => cancelAnimationFrame(frame));
    });

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

    // Previsão da Nubus para cada sentido do ponto escolhido, enquanto ele estiver na tela.
    effect((aoLimpar) => {
      const n = this.numero();
      const p = this.ponto();
      if (!n || !p) return;
      const assinaturas = p.sentidos.map((s) =>
        this.previsaoService.acompanhar(n, s.itinerario, s.parada.codigo).subscribe((r) => {
          // Falha: fica a última resposta, até ela ficar velha demais.
          if (!r) return;
          this.oficiais.set(`${s.itinerario}|${s.parada.codigo}`, {
            chegadas: r.chegadas,
            recebidoEm: Date.now(),
          });
          this.tique();
        }),
      );
      aoLimpar(() => {
        assinaturas.forEach((a) => a.unsubscribe());
        this.oficiais.clear();
      });
    });

    // Previsão da parada escolhida (sem linha), enquanto a lista de paradas estiver aberta.
    effect((aoLimpar) => {
      const codigo = this.paradaPertoSel();
      if (!codigo || !this.painelAberto() || this.menuAtual() !== 'paradas') return;
      untracked(() => {
        if (this.previsaoParada()?.codigo !== codigo)
          this.previsaoParada.set({ codigo, dados: null, falhou: false });
      });
      const assinatura = this.previsaoService.acompanharParada(codigo).subscribe((dados) => {
        const antes = this.previsaoParada();
        // Falha: fica a última resposta desta parada, se houver.
        if (dados) this.previsaoParada.set({ codigo, dados, falhou: false });
        else if (!antes?.dados) this.previsaoParada.set({ codigo, dados: null, falhou: true });
      });
      aoLimpar(() => assinatura.unsubscribe());
    });

    // Voltou ao mapa vazio (fechou a linha, limpou o trajeto): busca as paradas da área.
    effect(() => {
      if (this.mapaVazio()) untracked(() => this.agendarArea(0));
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
    else if (params.get('painel') === 'favoritas') this.abrirMenu('favoritas');
  }

  protected acompanhar(valor: string): void {
    const numero = valor.trim().toUpperCase();
    if (!numero) return;
    this.menuAtual.set('linhas');
    this.painelAberto.set(true);
    this.modoMapa.set('linha');
    this.planejador()?.pausarSelecao();
    if (numero === this.numero()) {
      this.fecharMenu();
      return;
    }

    this.assinatura?.unsubscribe();
    this.numero.set(numero);
    // Mantém a lista aberta durante a consulta; os primeiros dados fecham o painel.
    this.gaveta.set('alta');
    this.dados.set(null);
    this.erro.set(null);
    this.status.set(null);
    this.selecionado.set(null);
    this.pontoSel.set(null);
    this.sentidosPlaca.set([]);
    this.filtroParadas.set('');
    this.listaAberta.set(false);
    this.paradasLinhaAberta.set(false);
    this.frotaEscolha.set(null);
    this.esquecerSeguidos();
    this.carregando.set(true);
    this.atualizarUrl();

    this.assinatura = this.linhaService.acompanhar(numero).subscribe((a) => {
      switch (a.tipo) {
        case 'status':
          this.status.set(a.status);
          break;
        case 'dados': {
          const abriuAgora = this.dados() === null;
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
          if (abriuAgora && this.menuAtual() === 'linhas' && this.painelAberto()) this.fecharMenu();
          break;
        }
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

  /**
   * Volta à tela inicial: fecha a linha, as paradas perto e o trajeto, e o
   * mapa passa a mostrar as paradas da área visível.
   */
  protected voltarAoInicio(): void {
    this.assinatura?.unsubscribe();
    this.numero.set(null);
    this.dados.set(null);
    this.erro.set(null);
    this.status.set(null);
    this.carregando.set(false);
    this.selecionado.set(null);
    this.pontoSel.set(null);
    this.sentidosPlaca.set([]);
    this.esquecerSeguidos();
    this.paradaPendente = null;
    this.valorCampo.set('');
    this.campo().nativeElement.value = '';
    this.perto.set(null);
    this.paradaPertoSel.set(null);
    this.filtroPerto.set('');
    this.avisoPerto.set(null);
    this.planejador()?.limpar();
    this.pontosTrajeto.set({ origem: null, destino: null });
    this.viagemTrajeto.set(null);
    this.selecaoTrajeto.set(null);
    this.modoMapa.set('linha');
    this.atualizarUrl();
    this.fecharMenu();
    // Perto o bastante para as paradas aparecerem.
    requestAnimationFrame(() => this.mapa().aproximar(ZOOM_AREA + 1));
    this.anuncio.set('Início. O mapa mostra as paradas da região.');
  }

  protected aoMudarArea(area: AreaMapa): void {
    this.ultimaArea = area;
    if (this.mapaVazio()) this.agendarArea(250);
  }

  /** Espera o mapa parar um instante antes de buscar (arrastar dispara vários movimentos). */
  private agendarArea(atrasoMs: number): void {
    clearTimeout(this.timerArea);
    this.timerArea = setTimeout(() => void this.carregarArea(), atrasoMs);
  }

  private async carregarArea(): Promise<void> {
    const area = this.ultimaArea;
    if (!area || !this.mapaVazio()) return;
    this.consultaArea?.abort();
    this.longeDemais.set(area.zoom < ZOOM_AREA);
    if (area.zoom < ZOOM_AREA) {
      this.areaParadas.set([]);
      return;
    }
    const consulta = new AbortController();
    this.consultaArea = consulta;
    try {
      const lista = await this.previsaoService.naArea(area, consulta.signal);
      if (!consulta.signal.aborted) this.areaParadas.set(lista);
    } catch {
      // Sem resposta: ficam as paradas que já estavam; o próximo movimento tenta de novo.
    }
  }

  /** Toque no nome de uma parada da lista: mostra os próximos ônibus dela (ou fecha). */
  protected alternarParadaPerto(codigo: string): void {
    const fechar = this.paradaPertoSel() === codigo;
    this.paradaPertoSel.set(fechar ? null : codigo);
    if (fechar) return;
    const p = this.pontosMapa().find((x) => x.chave === codigo);
    if (p) this.mapa().irPara(p.lat, p.lng);
  }

  /** Mapa afastado demais na tela inicial: aproxima até as paradas aparecerem. */
  protected aproximarParadas(): void {
    this.mapa().aproximar(ZOOM_AREA + 1);
  }

  protected focar(id: string): void {
    this.selecionado.set(id);
    this.modoMapa.set('linha');
    this.fecharMenu();
    requestAnimationFrame(() => {
      if (this.selecionado() === id && this.modoMapa() === 'linha') this.mapa().focar(id);
    });
  }

  /** Escolhe o ponto do passageiro (pelo mapa, pela lista ou pelo link). */
  protected escolherPonto(chave: string, mover = true): void {
    const p = this.pontos().find((x) => x.chave === chave);
    if (!p) return;
    this.menuAtual.set('paradas');
    this.paradasLinhaAberta.set(true);
    this.painelAberto.set(true);
    this.modoMapa.set('linha');
    if (chave !== this.pontoSel()) this.oficiais.clear();
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
    this.paradasLinhaAberta.set(true);
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

  /** Tela inicial: paradas com ônibus perto do passageiro, sem precisar saber a linha. */
  protected async paradasPertoDeMim(): Promise<void> {
    this.avisoPerto.set(null);
    const problema = await this.local.pedir();
    const pos = this.local.posicao();
    if (problema || !pos) {
      this.avisoPerto.set(problema);
      return;
    }
    this.buscandoPerto.set(true);
    try {
      const lista = await this.previsaoService.proximas(pos.lat, pos.lng);
      this.perto.set(lista);
      this.paradaPertoSel.set(null);
      if (lista.length === 0) {
        this.avisoPerto.set('Nenhuma parada com ônibus a menos de 600 m de você.');
        return;
      }
      if (!this.painelAberto() || this.menuAtual() !== 'paradas') return;
      this.modoMapa.set('paradas');
      this.gaveta.set('media');
      const pontos: [number, number][] = [
        [pos.lat, pos.lng],
        ...lista.slice(0, 4).map((p): [number, number] => [p.lat, p.lng]),
      ];
      requestAnimationFrame(() => this.mapa().enquadrarVarios(pontos, this.folgasMapa('media')));
      this.anuncio.set(
        lista.length === 1 ? '1 parada perto de você' : `${lista.length} paradas perto de você`,
      );
    } catch {
      this.avisoPerto.set(
        'A central de dados dos ônibus não respondeu. Tente de novo em instantes.',
      );
    } finally {
      this.buscandoPerto.set(false);
    }
  }

  protected iniciarPlanejador(): void {
    this.abrirMenu('trajetos');
  }

  protected fecharPlanejador(): void {
    this.fecharMenu();
  }

  protected selecionarNoMapa(tipo: TipoPontoTrajeto | null): void {
    this.selecaoTrajeto.set(tipo);
    if (tipo) {
      this.modoMapa.set('trajeto');
      this.gaveta.set('baixa');
    } else if (this.menuAtual() === 'trajetos' && this.painelAberto()) this.gaveta.set('media');
    this.anuncio.set(
      tipo ? `Escolha ${tipo === 'origem' ? 'a origem' : 'o destino'} no mapa` : 'Ponto escolhido',
    );
  }

  protected abrirMenu(menu: Menu): void {
    this.guardarPainel();
    this.planejador()?.pausarSelecao();
    this.menuAtual.set(menu);
    this.painelAberto.set(true);
    this.gaveta.set(this.alturas.get(menu) ?? 'media');
    this.anuncio.set(this.tituloMenu());
    requestAnimationFrame(() => {
      const conteudo = this.host.querySelector('.conteudo');
      if (conteudo) conteudo.scrollTop = this.rolagens.get(menu) ?? 0;
    });
  }

  protected async carregarCatalogo(): Promise<void> {
    this.consultaCatalogo?.abort();
    const consulta = new AbortController();
    this.consultaCatalogo = consulta;
    this.carregandoCatalogo.set(true);
    this.erroCatalogo.set(null);
    try {
      const linhas = await this.catalogoService.listar(consulta.signal);
      if (!consulta.signal.aborted) this.catalogo.set(linhas);
    } catch {
      if (!consulta.signal.aborted)
        this.erroCatalogo.set(
          'Não foi possível carregar a lista de linhas. Você pode abrir uma linha pelo número.',
        );
    } finally {
      if (this.consultaCatalogo === consulta) this.carregandoCatalogo.set(false);
    }
  }

  protected abrirResultadoBusca(): void {
    const numero = this.numeroBusca();
    if (numero) this.acompanhar(numero);
    else if (this.linhasBusca().length === 1) this.acompanhar(this.linhasBusca()[0].numero);
  }

  protected limparBusca(): void {
    this.valorCampo.set('');
    this.campo().nativeElement.value = '';
    this.campo().nativeElement.focus();
  }

  protected alternarMenu(menu: Menu): void {
    if (this.painelAberto() && this.menuAtual() === menu) this.fecharMenu();
    else this.abrirMenu(menu);
  }

  private guardarPainel(): void {
    if (!this.painelAberto()) return;
    this.rolagens.set(this.menuAtual(), this.host.querySelector('.conteudo')?.scrollTop ?? 0);
    this.alturas.set(this.menuAtual(), this.gaveta());
  }

  protected fecharMenu(): void {
    this.guardarPainel();
    this.painelAberto.set(false);
    this.planejador()?.pausarSelecao();
    this.anuncio.set('Painel fechado. Mapa disponível.');
  }

  protected alterarPontosTrajeto(pontos: PontosTrajeto): void {
    this.pontosTrajeto.set(pontos);
    this.modoMapa.set('trajeto');
  }

  protected escolherTema(tema: 'dia' | 'noite'): void {
    if (this.tema() !== tema) this.temaService.alternar();
  }

  protected aoTocarMapa(ponto: LocalTrajeto): void {
    const tipo = this.selecaoTrajeto();
    if (tipo) this.planejador()?.definirPonto(tipo, ponto);
  }

  protected usarCentroMapa(): void {
    const centro = this.mapa().centro();
    if (centro) this.aoTocarMapa(centro);
  }

  protected mostrarViagem(viagem: Viagem | null): void {
    this.viagemTrajeto.set(viagem);
    if (!viagem || !this.painelAberto() || this.menuAtual() !== 'trajetos') return;
    this.modoMapa.set('trajeto');
    this.gaveta.set('media');
    requestAnimationFrame(() => {
      if (
        !this.painelAberto() ||
        this.menuAtual() !== 'trajetos' ||
        this.viagemTrajeto() !== viagem
      )
        return;
      this.mapa().enquadrarVarios(
        [
          ...viagem.trechos.flatMap((t) => t.tracado),
          ...viagem.trechos.flatMap((t): [number, number][] => [
            [t.partida.lat, t.partida.lng],
            [t.chegada.lat, t.chegada.lng],
          ]),
        ],
        this.folgasMapa('media'),
      );
      this.host
        .querySelector('app-planejador .resultados')
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }

  /** Abre a linha já com o ponto escolhido (vindo da lista "perto de você"). */
  protected abrirNaParada(numero: string, codigoParada: string): void {
    if (numero === this.numero() && this.linha()) {
      this.abrirMenu('linhas');
      const ponto = acharPonto(this.pontos(), codigoParada);
      if (ponto) this.escolherPonto(ponto.chave);
      return;
    }
    this.paradaPendente = codigoParada;
    this.acompanhar(numero);
  }

  /** Toque numa parada do mapa: escolhe o ponto da linha ou, sem linha, mostra a parada na lista. */
  protected aoTocarPonto(chave: string): void {
    const tipo = this.selecaoTrajeto();
    if (tipo) {
      // Escolhendo origem ou destino: a parada tocada vira o ponto do trajeto.
      const p = this.pontosMapa().find((x) => x.chave === chave);
      if (p) this.planejador()?.definirPonto(tipo, { lat: p.lat, lng: p.lng, nome: p.nome });
      return;
    }
    if (this.linha() && this.modoMapa() !== 'paradas') {
      this.escolherPonto(chave, false);
      return;
    }
    this.abrirMenu('paradas');
    this.paradaPertoSel.set(chave);
    if (this.gaveta() === 'baixa') this.gaveta.set('media');
    requestAnimationFrame(() =>
      this.host
        .querySelector(`[data-parada="${CSS.escape(chave)}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    );
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

  // ---- arrastar a gaveta pela alça ou pelo cabeçalho (celular) ----
  // A gaveta segue o dedo; ao soltar, desliza até a altura mais próxima de
  // onde o gesto ia parar (a velocidade conta: um peteleco também vale).
  private arrasto: {
    id: number;
    y: number;
    /** Altura visível no começo do gesto e agora (px). */
    inicioPx: number;
    px: number;
    /** Últimas posições do dedo, para a velocidade ao soltar. */
    amostras: { y: number; t: number }[];
    moveu: boolean;
    alca: boolean;
  } | null = null;

  protected arrastoInicio(e: PointerEvent, alca = false): void {
    if (this.arrasto || !celular()) return; // um segundo dedo não assume o arrasto
    // Botões do cabeçalho (fechar) continuam sendo botões.
    if (!alca && (e.target as HTMLElement).closest('button, input, a')) return;
    // Sem isso o mouse seleciona o título, e o próximo arrasto vira "arrastar texto".
    e.preventDefault();
    const px = this.alturaVisivel(this.gaveta());
    this.arrasto = {
      id: e.pointerId,
      y: e.clientY,
      inicioPx: px,
      px,
      amostras: [{ y: e.clientY, t: e.timeStamp }],
      moveu: false,
      alca,
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  protected arrastoMove(e: PointerEvent): void {
    const a = this.arrasto;
    if (!a || e.pointerId !== a.id) return;
    const dy = e.clientY - a.y;
    // Alguns pixels de tremida ainda são um toque.
    if (!a.moveu && Math.abs(dy) < 6) return;
    a.moveu = true;
    const total = this.host.querySelector<HTMLElement>('.painel')?.offsetHeight ?? 0;
    a.px = Math.max(0, Math.min(total, a.inicioPx - dy));
    a.amostras.push({ y: e.clientY, t: e.timeStamp });
    if (a.amostras.length > 6) a.amostras.shift();
    this.posicionarGaveta(a.px);
  }

  /** Fim do gesto. Um toque na alça sem arrastar alterna a altura; um cancelamento volta ao lugar. */
  protected arrastoFim(e: PointerEvent, cancelado = false): void {
    const a = this.arrasto;
    if (!a || e.pointerId !== a.id) return;
    this.arrasto = null;
    if (!a.moveu || cancelado) {
      this.posicionarGaveta(null);
      if (!cancelado && a.alca) {
        this.fimToqueAlca = performance.now();
        this.ciclarGaveta();
      }
      return;
    }

    // Velocidade nos últimos ~100 ms (px/ms; positivo = dedo descendo).
    const fim = a.amostras.at(-1)!;
    const inicio = a.amostras.find((s) => fim.t - s.t <= 100) ?? a.amostras[0];
    const velocidade = fim.t > inicio.t ? (fim.y - inicio.y) / (fim.t - inicio.t) : 0;
    const destino = a.px - velocidade * 180;

    // Abaixo da altura mínima: a gaveta sai de cena e o mapa fica livre.
    if (destino < this.alturaVisivel('baixa') * 0.6) {
      const painel = this.host.querySelector<HTMLElement>('.painel');
      if (painel) {
        painel.style.transition = 'transform 0.2s ease-in, clip-path 0.2s ease-in';
        painel.style.transform = `translateY(${painel.offsetHeight}px)`;
      }
      setTimeout(() => {
        this.fecharMenu();
        this.posicionarGaveta(null);
      }, 200);
      return;
    }
    const alvo = (['baixa', 'media', 'alta'] as Gaveta[]).reduce((melhor, g) =>
      Math.abs(this.alturaVisivel(g) - destino) < Math.abs(this.alturaVisivel(melhor) - destino)
        ? g
        : melhor,
    );
    // Tira a posição do dedo e muda a altura no mesmo quadro: o CSS anima
    // de onde a gaveta está até a altura escolhida.
    this.posicionarGaveta(null);
    this.gaveta.set(alvo);
  }

  /** Altura visível da gaveta em cada posição (px). */
  private alturaVisivel(g: Gaveta): number {
    const total = this.host.querySelector<HTMLElement>('.painel')?.offsetHeight ?? innerHeight;
    if (g === 'alta') return total;
    if (g === 'media') return Math.min(total, innerHeight * ALTURA_MEDIA);
    return Math.min(total, this.alturaBaixaPx || 150);
  }

  /** Durante o arrasto, a gaveta fica exatamente sob o dedo; `null` devolve o controle ao CSS. */
  private posicionarGaveta(px: number | null): void {
    const painel = this.host.querySelector<HTMLElement>('.painel');
    if (!painel) return;
    if (px === null) {
      painel.style.removeProperty('transition');
      painel.style.removeProperty('transform');
      painel.style.removeProperty('clip-path');
      this.host.classList.remove('arrastando');
      return;
    }
    const desloca = painel.offsetHeight - px;
    painel.style.transition = 'none';
    painel.style.transform = `translateY(${desloca}px)`;
    painel.style.clipPath = `inset(0 0 ${desloca}px 0 round 18px)`;
    // Os controles do mapa sobem e descem junto, sem atraso.
    this.host.classList.add('arrastando');
    this.host.style.setProperty('--altura-gaveta', `${px}px`);
  }

  protected tecla(e: KeyboardEvent): void {
    const alvo = e.target as HTMLElement | null;
    const digitando = alvo?.tagName === 'INPUT';
    if (e.key === 'Escape') {
      if (this.selecaoTrajeto()) this.planejador()?.pausarSelecao();
      else if (this.painelAberto()) this.fecharMenu();
      else if (this.listaAberta()) this.listaAberta.set(false);
      else if (this.selecionado()) this.selecionado.set(null);
      else if (this.pontoSel()) this.trocarPonto();
      if (digitando) alvo?.blur();
    } else if (digitando || e.ctrlKey || e.metaKey || e.altKey) {
      return;
    } else if (e.key === '/') {
      e.preventDefault();
      this.abrirMenu('linhas');
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
      const topo = this.host.querySelector('.linha-atual')?.getBoundingClientRect().bottom ?? 132;
      const menu = this.host.querySelector('.navegacao nav')?.getBoundingClientRect().height ?? 80;
      const disponivel =
        this.host.querySelector<HTMLElement>('.painel')?.offsetHeight ?? innerHeight * ALTURA_MEDIA;
      const painel = this.painelAberto()
        ? Math.min(
            disponivel,
            gaveta === 'baixa'
              ? this.alturaBaixaPx
              : gaveta === 'alta'
                ? disponivel
                : innerHeight * ALTURA_MEDIA,
          )
        : (this.host.querySelector('.contexto-mapa')?.getBoundingClientRect().height ?? 0);
      const base = painel + menu + 20;
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
    // Durante o arrasto quem manda é o dedo.
    if (!celular() || this.arrasto?.moveu) return;
    if (!this.painelAberto()) {
      this.host.style.setProperty('--altura-gaveta', '0px');
      this.host.style.setProperty(
        '--contexto-h',
        `${this.host.querySelector('.contexto-mapa')?.getBoundingClientRect().height ?? 0}px`,
      );
      return;
    }
    const painel = this.host.querySelector<HTMLElement>('.painel');
    const pagina = painel?.querySelector('.pagina-menu:not([hidden])');
    // Sem uma resposta para mostrar (placa, botão do ponto), a gaveta baixa
    // é só o cabeçalho (e a busca, nas linhas): o resto do espaço é do mapa.
    const ancora =
      pagina?.querySelector('[data-ancora]') ??
      painel?.querySelector('.linha-busca:not([hidden])') ??
      painel?.querySelector('.cabecalho-painel');
    if (!painel || !ancora) return;
    const bruto =
      ancora.getBoundingClientRect().bottom -
      painel.getBoundingClientRect().top +
      (painel.querySelector('.conteudo')?.scrollTop ?? 0) +
      16;
    const altura = Math.round(Math.max(96, Math.min(bruto, innerHeight * 0.6)));
    const visivel =
      this.gaveta() === 'alta'
        ? painel.offsetHeight
        : this.gaveta() === 'media'
          ? Math.min(painel.offsetHeight, innerHeight * ALTURA_MEDIA)
          : Math.min(painel.offsetHeight, altura);
    this.host.style.setProperty('--altura-gaveta', `${visivel}px`);
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
      const { previsoes, fonte, tabela } = mesclarPrevisoes(
        this.mapa().previsoes(s),
        this.oficiais.get(`${s.itinerario}|${s.parada.codigo}`) ?? null,
        agora,
      );
      return {
        itinerario: s.itinerario,
        destino: it?.destino ?? s.itinerario,
        cor: it?.cor ?? COR_SEM_ROTA,
        rumo: this.mapa().rumo(s),
        previsoes,
        fonte,
        tabela,
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

/** Parada como a lista mostra: nome legível e as linhas com o destino de cada uma. */
function itemParada(p: ParadaProxima, distancia: string | null) {
  return {
    ...p,
    nome: nomeParada(p.descricao) || 'Parada sem endereço',
    distancia,
    linhas: p.linhas.map((l) => ({
      numero: l.numero,
      destino: l.itinerarios.length ? destino(l.itinerarios[0]) : null,
      rotulo: [`Linha ${l.numero}`, ...l.itinerarios.map(destino)].join(', '),
    })),
  };
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
