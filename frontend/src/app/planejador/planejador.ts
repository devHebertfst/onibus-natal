import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { LocalizacaoService } from '../core/localizacao.service';
import { horaLocal } from '../core/previsao-oficial';
import { distanciaTexto } from '../core/texto';
import { LocalTrajeto, PontosTrajeto, TipoPontoTrajeto, Viagem } from '../core/trajeto.models';
import { TrajetoService } from '../core/trajeto.service';

/** Valor do datetime-local em hora de Natal, independente do fuso do aparelho. */
export function horarioNatal(ms: number): string {
  return new Date(ms - 3 * 60 * 60_000).toISOString().slice(0, 16);
}

@Component({
  selector: 'app-planejador',
  templateUrl: './planejador.html',
  styleUrl: './planejador.scss',
})
export class Planejador {
  protected readonly local = inject(LocalizacaoService);
  private readonly trajetos = inject(TrajetoService);
  readonly pontosAlterados = output<PontosTrajeto>();
  readonly selecaoAlterada = output<TipoPontoTrajeto | null>();
  readonly viagemEscolhida = output<Viagem | null>();
  readonly centroSolicitado = output<void>();
  readonly fechado = output<void>();
  readonly cabecalho = input(true);
  protected readonly origem = signal<LocalTrajeto | null>(null);
  protected readonly destino = signal<LocalTrajeto | null>(null);
  protected readonly selecionando = signal<TipoPontoTrajeto | null>(null);
  protected readonly partida = signal(horarioNatal(Date.now()));
  protected readonly buscando = signal(false);
  protected readonly aviso = signal<string | null>(null);
  protected readonly viagens = signal<Viagem[] | null>(null);
  protected readonly indice = signal(0);
  protected readonly escolhida = computed(() => this.viagens()?.[this.indice()] ?? null);
  protected readonly soCaminhada = computed(
    () =>
      !!this.viagens()?.length &&
      this.viagens()!.every((v) => v.trechos.every((t) => t.modo === 'WALK')),
  );
  protected readonly hora = (iso: string) => horaLocal(Date.parse(iso));
  protected readonly distancia = distanciaTexto;
  protected readonly minutos = (segundos: number) => Math.max(1, Math.ceil(segundos / 60));
  private consulta?: AbortController;
  private destruido = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destruido = true;
      this.consulta?.abort();
    });
  }

  protected selecionar(tipo: TipoPontoTrajeto | null): void {
    this.selecionando.set(tipo);
    this.selecaoAlterada.emit(tipo);
  }

  /** Suspende o clique no mapa sem apagar os pontos ou os resultados. */
  pausarSelecao(): void {
    this.selecionar(null);
  }

  protected inverter(): void {
    const origem = this.origem();
    this.origem.set(this.destino());
    this.destino.set(origem);
    this.invalidar();
    this.pontosAlterados.emit({ origem: this.origem(), destino: this.destino() });
    this.selecionar(null);
  }

  /** Chamado pela tela quando o passageiro escolhe um ponto no mapa. */
  definirPonto(tipo: TipoPontoTrajeto, ponto: LocalTrajeto): void {
    this.invalidar();
    (tipo === 'origem' ? this.origem : this.destino).set(ponto);
    this.pontosAlterados.emit({ origem: this.origem(), destino: this.destino() });
    this.selecionar(null);
  }

  protected async usarLocalizacao(): Promise<void> {
    this.aviso.set(null);
    const problema = await this.local.pedir();
    if (this.destruido) return;
    const pos = this.local.posicao();
    if (problema || !pos) {
      this.aviso.set(problema ?? 'Não conseguimos encontrar sua localização. Escolha no mapa.');
      return;
    }
    this.definirPonto('origem', { nome: 'Minha localização', lat: pos.lat, lng: pos.lng });
  }

  protected mudarHorario(valor: string): void {
    this.partida.set(valor);
    this.invalidar();
  }

  protected agora(): void {
    this.mudarHorario(horarioNatal(Date.now()));
  }

  private invalidar(): void {
    this.consulta?.abort();
    this.consulta = undefined;
    this.buscando.set(false);
    this.viagens.set(null);
    this.aviso.set(null);
    this.viagemEscolhida.emit(null);
  }

  protected async buscar(): Promise<void> {
    const origem = this.origem();
    const destino = this.destino();
    if (!origem || !destino || !this.partida()) return;
    this.invalidar();
    const consulta = new AbortController();
    this.consulta = consulta;
    this.buscando.set(true);
    this.selecionar(null);
    try {
      const resposta = await this.trajetos.planejar(
        origem,
        destino,
        this.partida(),
        consulta.signal,
      );
      if (consulta.signal.aborted) return;
      this.viagens.set(resposta.viagens);
      this.escolher(0);
    } catch {
      if (!consulta.signal.aborted)
        this.aviso.set('A central de trajetos não respondeu. Tente de novo em instantes.');
    } finally {
      if (this.consulta === consulta) {
        this.consulta = undefined;
        this.buscando.set(false);
      }
    }
  }

  protected escolher(indice: number): void {
    this.indice.set(indice);
    this.viagemEscolhida.emit(this.escolhida());
  }
}
