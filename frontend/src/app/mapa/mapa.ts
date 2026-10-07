import { Component, DestroyRef, effect, inject, input, output } from '@angular/core';
import { LeafletModule } from '@bluehalo/ngx-leaflet';
import * as L from 'leaflet';
import { Linha } from '../core/linha.models';
import { Frota } from './dead-reckoning/frota';

export interface DadosMapa {
  linha: Linha;
  recebidoEm: number;
}

/** Cores dos itinerários (ida, volta, variantes...). */
export const CORES = ['#1565c0', '#e65100', '#2e7d32', '#6a1b9a', '#ad1457', '#00838f'];
const COR_SEM_ROTA = '#616161';

const NATAL: L.LatLngTuple = [-5.7945, -35.211];

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
  readonly onibusClicado = output<string>();

  private readonly tiles = {
    'Esri Light Gray': L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 16,
        attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap',
      },
    ),
    OpenStreetMap: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }),
  };

  readonly opcoes: L.MapOptions = {
    layers: [this.tiles['Esri Light Gray']],
    center: NATAL,
    zoom: 12,
    zoomControl: true,
  };

  private mapa?: L.Map;
  private readonly camadaTracado = L.layerGroup();
  private readonly camadaParadas = L.layerGroup();
  private readonly camadaOnibus = L.layerGroup();
  private readonly marcadores = new Map<string, Marcador>();
  private frota = new Frota();
  private numeroAtual: string | null = null;
  private assinaturaTracado = '';
  private cores = new Map<string, string>();
  private raf = 0;

  constructor() {
    effect(() => {
      const dados = this.dados();
      if (this.mapa) this.aplicar(dados);
    });
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.raf));
  }

  aoCarregar(mapa: L.Map): void {
    this.mapa = mapa;
    this.camadaTracado.addTo(mapa);
    this.camadaParadas.addTo(mapa);
    this.camadaOnibus.addTo(mapa);
    L.control
      .layers(
        this.tiles,
        { Paradas: this.camadaParadas, Ônibus: this.camadaOnibus },
        { position: 'topright' },
      )
      .addTo(mapa);
    this.aplicar(this.dados());
    this.loop();
  }

  /** Centraliza o mapa num ônibus. */
  focar(id: string): void {
    const m = this.marcadores.get(id);
    if (m && this.mapa) this.mapa.flyTo(m.marker.getLatLng(), Math.max(this.mapa.getZoom(), 16));
  }

  private aplicar(dados: DadosMapa | null): void {
    if (!dados) {
      this.limpar();
      return;
    }
    const { linha, recebidoEm } = dados;
    if (linha.numero !== this.numeroAtual) {
      this.limpar();
      this.numeroAtual = linha.numero;
    }

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
      m.texto = `${o.id} · ${o.velocidadeKmh} km/h`;
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
    this.cores = new Map(linha.itinerarios.map((it, i) => [it.codigo, CORES[i % CORES.length]]));

    const limites = L.latLngBounds([]);
    for (const it of linha.itinerarios) {
      const cor = this.cores.get(it.codigo)!;
      if (it.tracado.length >= 2) {
        const linhaMapa = L.polyline(it.tracado, { color: cor, weight: 4, opacity: 0.7 })
          .bindTooltip(it.descricao, { sticky: true })
          .addTo(this.camadaTracado);
        limites.extend(linhaMapa.getBounds());
      }
      for (const p of it.paradas) {
        L.circleMarker([p.lat, p.lng], {
          radius: 4,
          color: cor,
          weight: 2,
          fillColor: '#fff',
          fillOpacity: 1,
        })
          .bindTooltip(p.descricao || `Parada ${p.codigo}`)
          .addTo(this.camadaParadas);
      }
    }
    if (limites.isValid()) this.mapa?.fitBounds(limites, { padding: [24, 24] });
  }

  private criarMarcador(id: string, lat: number, lng: number): Marcador {
    const icone = L.divIcon({
      className: 'onibus-icone',
      html: `<div class="onibus"><div class="seta"></div><div class="rotulo"></div></div>`,
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
        m.ultimoRumo = null;
        m.ultimaCor = '';
      }

      const cor = q.itinerario ? (this.cores.get(q.itinerario) ?? COR_SEM_ROTA) : COR_SEM_ROTA;
      if (m.seta && cor !== m.ultimaCor) {
        m.seta.style.setProperty('--cor', cor);
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
    this.frota = new Frota();
    this.numeroAtual = null;
    this.assinaturaTracado = '';
  }
}
