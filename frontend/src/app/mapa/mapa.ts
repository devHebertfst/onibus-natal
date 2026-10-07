import { Component, DestroyRef, effect, inject, input, output } from '@angular/core';
import { LeafletModule } from '@bluehalo/ngx-leaflet';
import * as L from 'leaflet';
import { Linha, Parada } from '../core/linha.models';
import { Frota } from './dead-reckoning/frota';
import { Previsao, preverChegadas } from './dead-reckoning/previsao';

export interface DadosMapa {
  linha: Linha;
  recebidoEm: number;
}

export interface ParadaSelecionada {
  itinerario: string;
  parada: Parada;
}

export type EstiloMapa = 'escuro' | 'claro';

/** Cores dos itinerários (ida, volta, variantes...), legíveis sobre o mapa escuro. */
export const CORES = ['#f4423e', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2', '#3bc9db'];
export const COR_SEM_ROTA = '#8a8585';

const NATAL: L.LatLngTuple = [-5.7945, -35.211];
const ATRIBUICAO = 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap';

/** Mapas-base da Esri (sem chave de API): fundo sem rótulos + camada de nomes por cima. */
function esri(servico: string): L.TileLayer {
  return L.tileLayer(
    `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${servico}/MapServer/tile/{z}/{y}/{x}`,
    // Acima do zoom 16 a Esri não tem tiles: amplia os do 16.
    { maxNativeZoom: 16, maxZoom: 19, attribution: ATRIBUICAO },
  );
}

interface Marcador {
  marker: L.Marker;
  texto: string;
  /** Elemento DOM atual (o Leaflet o recria se a camada for desligada e religada). */
  el?: HTMLElement;
  seta?: HTMLElement | null;
  ultimoRumo: number | null;
  ultimaCor: string;
}

@Component({
  selector: 'app-mapa',
  imports: [LeafletModule],
  template: `<div
    class="mapa"
    leaflet
    [leafletOptions]="opcoes"
    (leafletMapReady)="aoCarregar($event)"
  ></div>`,
  styleUrl: './mapa.scss',
})
export class Mapa {
  readonly dados = input<DadosMapa | null>(null);
  readonly estilo = input<EstiloMapa>('escuro');
  readonly selecionado = input<string | null>(null);
  readonly paradaSelecionada = input<ParadaSelecionada | null>(null);
  readonly onibusClicado = output<string>();
  readonly paradaClicada = output<ParadaSelecionada>();

  private readonly tiles: Record<EstiloMapa, L.LayerGroup> = {
    escuro: L.layerGroup([esri('World_Dark_Gray_Base'), esri('World_Dark_Gray_Reference')]),
    claro: L.layerGroup([esri('World_Light_Gray_Base'), esri('World_Light_Gray_Reference')]),
  };

  readonly opcoes: L.MapOptions = {
    center: NATAL,
    zoom: 13,
    zoomControl: false,
    attributionControl: true,
  };

  private mapa?: L.Map;
  private readonly camadaTracado = L.layerGroup();
  private readonly camadaParadas = L.layerGroup();
  private readonly camadaOnibus = L.layerGroup();
  private readonly marcadores = new Map<string, Marcador>();
  private readonly paradas = new Map<string, L.CircleMarker>();
  private eu?: L.Marker;
  private frota = new Frota();
  private linhaAtual: Linha | null = null;
  private assinaturaTracado = '';
  private limitesTracado?: L.LatLngBounds;
  private cores = new Map<string, string>();
  private raf = 0;

  constructor() {
    effect(() => {
      const dados = this.dados();
      if (this.mapa) this.aplicar(dados);
    });
    effect(() => {
      const estilo = this.estilo();
      if (this.mapa) this.aplicarEstilo(estilo);
    });
    effect(() => {
      const id = this.selecionado();
      for (const [chave, m] of this.marcadores)
        m.marker.getElement()?.classList.toggle('selecionado', chave === id);
    });
    effect(() => {
      const sel = this.paradaSelecionada();
      for (const [chave, c] of this.paradas) {
        const ativa = sel !== null && chave === chaveParada(sel.itinerario, sel.parada.codigo);
        c.setRadius(ativa ? 8 : 4);
        c.getElement()?.classList.toggle('ativa', ativa);
        if (ativa) c.bringToFront();
      }
    });
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.raf));
  }

  aoCarregar(mapa: L.Map): void {
    this.mapa = mapa;
    this.aplicarEstilo(this.estilo());
    L.control
      .zoom({ position: 'bottomright', zoomInTitle: 'Aproximar', zoomOutTitle: 'Afastar' })
      .addTo(mapa);
    mapa.attributionControl.setPrefix(false);
    this.camadaTracado.addTo(mapa);
    this.camadaParadas.addTo(mapa);
    this.camadaOnibus.addTo(mapa);
    this.aplicar(this.dados());
    this.loop();
  }

  /** Centraliza o mapa num ônibus. */
  focar(id: string): void {
    const m = this.marcadores.get(id);
    if (m && this.mapa) this.mapa.flyTo(m.marker.getLatLng(), Math.max(this.mapa.getZoom(), 16));
  }

  /** Volta a mostrar o traçado inteiro da linha. */
  enquadrar(): void {
    if (this.limitesTracado?.isValid())
      this.mapa?.flyToBounds(this.limitesTracado, { padding: [48, 48] });
  }

  /** Centraliza na posição do aparelho. Devolve uma mensagem se não der. */
  centralizarEmMim(): Promise<string | null> {
    if (!('geolocation' in navigator))
      return Promise.resolve('Este aparelho não oferece geolocalização.');
    return new Promise((resolve) =>
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          const pos: L.LatLngTuple = [coords.latitude, coords.longitude];
          if (!this.eu) {
            this.eu = L.marker(pos, {
              icon: L.divIcon({
                className: 'eu-icone',
                html: '<div class="eu"></div>',
                iconSize: [0, 0],
              }),
              keyboard: false,
              interactive: false,
            });
          }
          if (this.mapa) {
            this.eu.setLatLng(pos).addTo(this.mapa);
            this.mapa.flyTo(pos, Math.max(this.mapa.getZoom(), 16));
          }
          resolve(null);
        },
        (e) =>
          resolve(
            e.code === e.PERMISSION_DENIED
              ? 'Permita o acesso à localização para centralizar no mapa.'
              : e.code === e.TIMEOUT
                ? 'A localização demorou demais para responder.'
                : 'Localização indisponível no momento.',
          ),
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
      ),
    );
  }

  /** Itinerário (sentido) inferido de cada ônibus pelo dead reckoning. */
  sentidos(): Map<string, string | null> {
    return new Map(
      [...this.frota.onibus].map(([id, o]) => [id, o.posicaoNaRota()?.codigo ?? null]),
    );
  }

  /** Ônibus a caminho de uma parada, com estimativa de chegada. */
  previsoes(sel: ParadaSelecionada): Previsao[] {
    const it = this.linhaAtual?.itinerarios.find((i) => i.codigo === sel.itinerario);
    return it ? preverChegadas(this.frota, it.codigo, it.paradas, sel.parada.codigo) : [];
  }

  private aplicarEstilo(estilo: EstiloMapa): void {
    if (!this.mapa) return;
    for (const [nome, camada] of Object.entries(this.tiles)) {
      if (nome === estilo) camada.addTo(this.mapa);
      else camada.remove();
    }
    this.mapa.getContainer().classList.toggle('mapa-claro', estilo === 'claro');
  }

  private aplicar(dados: DadosMapa | null): void {
    if (!dados) {
      this.limpar();
      return;
    }
    const { linha, recebidoEm } = dados;
    if (linha.numero !== this.linhaAtual?.numero) this.limpar();
    this.linhaAtual = linha;

    this.desenharTracado(linha);
    const removidos = this.frota.sincronizar(linha, recebidoEm, Date.now());
    for (const id of removidos) {
      this.marcadores.get(id)?.marker.remove();
      this.marcadores.delete(id);
    }
    for (const o of linha.onibus) {
      if (!this.marcadores.has(o.id))
        this.marcadores.set(o.id, this.criarMarcador(o.id, o.lat, o.lng));
      const m = this.marcadores.get(o.id)!;
      m.texto = o.velocidadeKmh === null ? o.id : `${o.id} · ${o.velocidadeKmh} km/h`;
      const rotulo = m.el?.querySelector('.rotulo');
      if (rotulo) rotulo.textContent = m.texto;
    }
  }

  private desenharTracado(linha: Linha): void {
    const assinatura = linha.itinerarios.map((i) => `${i.codigo}:${i.tracado.length}`).join(';');
    if (assinatura === this.assinaturaTracado) return;
    this.assinaturaTracado = assinatura;

    this.camadaTracado.clearLayers();
    this.camadaParadas.clearLayers();
    this.paradas.clear();
    this.cores = new Map(linha.itinerarios.map((it, i) => [it.codigo, CORES[i % CORES.length]]));

    const limites = L.latLngBounds([]);
    for (const it of linha.itinerarios) {
      const cor = this.cores.get(it.codigo)!;
      if (it.tracado.length >= 2) {
        // Halo largo e translúcido + linha fina: efeito de "brilho" no mapa escuro.
        L.polyline(it.tracado, { color: cor, weight: 11, opacity: 0.16, interactive: false }).addTo(
          this.camadaTracado,
        );
        const linhaMapa = L.polyline(it.tracado, { color: cor, weight: 3.5, opacity: 0.95 })
          .bindTooltip(it.descricao, { sticky: true, className: 'dica' })
          .addTo(this.camadaTracado);
        limites.extend(linhaMapa.getBounds());
      }
      for (const p of it.paradas) {
        const marcador = L.circleMarker([p.lat, p.lng], {
          radius: 4,
          color: cor,
          weight: 2,
          fillOpacity: 1,
          className: 'parada',
        })
          .bindTooltip(p.descricao || `Parada ${p.codigo}`, { className: 'dica' })
          .on('click', () => this.paradaClicada.emit({ itinerario: it.codigo, parada: p }))
          .addTo(this.camadaParadas);
        this.paradas.set(chaveParada(it.codigo, p.codigo), marcador);
      }
    }
    this.limitesTracado = limites;
    if (limites.isValid()) this.mapa?.fitBounds(limites, { padding: [48, 48] });
  }

  private criarMarcador(id: string, lat: number, lng: number): Marcador {
    const icone = L.divIcon({
      className: 'onibus-icone',
      html: `<div class="onibus"><div class="pulso"></div><div class="seta"></div><div class="rotulo"></div></div>`,
      iconSize: [0, 0],
    });
    const marker = L.marker([lat, lng], { icon: icone, keyboard: false, riseOnHover: true })
      .on('click', () => this.onibusClicado.emit(id))
      .addTo(this.camadaOnibus);
    return { marker, texto: id, ultimoRumo: null, ultimaCor: '' };
  }

  /** Loop de animação: a cada quadro, reposiciona os ônibus pelo dead reckoning. */
  private loop = (): void => {
    const agora = Date.now();
    for (const [id, animado] of this.frota.onibus) {
      const m = this.marcadores.get(id);
      const q = animado.quadro(agora);
      if (!m || !q) continue;
      m.marker.setLatLng([q.lat, q.lng]);

      const el = m.marker.getElement();
      if (el !== m.el) {
        m.el = el;
        m.seta = el?.querySelector<HTMLElement>('.seta');
        const rotulo = el?.querySelector('.rotulo');
        if (rotulo) rotulo.textContent = m.texto;
        el?.classList.toggle('selecionado', id === this.selecionado());
        m.ultimoRumo = null;
        m.ultimaCor = '';
      }

      const cor = q.itinerario ? (this.cores.get(q.itinerario) ?? COR_SEM_ROTA) : COR_SEM_ROTA;
      if (m.el && cor !== m.ultimaCor) {
        m.el.style.setProperty('--cor', cor);
        m.ultimaCor = cor;
      }
      if (
        m.seta &&
        q.rumo !== null &&
        (m.ultimoRumo === null || Math.abs(q.rumo - m.ultimoRumo) > 1)
      ) {
        m.seta.style.transform = `rotate(${q.rumo}deg)`;
        m.seta.classList.add('com-rumo');
        m.ultimoRumo = q.rumo;
      }
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private limpar(): void {
    this.camadaTracado.clearLayers();
    this.camadaParadas.clearLayers();
    this.camadaOnibus.clearLayers();
    this.marcadores.clear();
    this.paradas.clear();
    this.frota = new Frota();
    this.linhaAtual = null;
    this.assinaturaTracado = '';
    this.limitesTracado = undefined;
  }
}

function chaveParada(itinerario: string, codigo: string): string {
  return `${itinerario}|${codigo}`;
}
