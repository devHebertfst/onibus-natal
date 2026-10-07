import { Component, DestroyRef, effect, inject, input, output } from '@angular/core';
import { LeafletModule } from '@bluehalo/ngx-leaflet';
import * as L from 'leaflet';
import { Posicao } from '../core/localizacao.service';
import { Linha } from '../core/linha.models';
import { ParadaNoSentido, PontoFisico } from '../core/pontos';
import { Tema } from '../core/tema.service';
import { Frota } from './dead-reckoning/frota';
import { Previsao, preverChegadas, rumoNaParada } from './dead-reckoning/previsao';

export interface DadosMapa {
  linha: Linha;
  recebidoEm: number;
}

/**
 * Cores dos sentidos (ida, volta, variantes...), tiradas da sinalização:
 * azul de serviço, laranja de obras, verde, e reservas. Legíveis sobre o
 * mapa claro e o escuro.
 */
const CORES_DIA = ['#1d5fd1', '#d9590b', '#0f7a43', '#9c2f86', '#0b7f8c', '#7a5418'];
/** As mesmas cores, mais claras, para continuarem visíveis no mapa escuro. */
const CORES_NOITE = ['#6b9cf2', '#f0813a', '#3fb57a', '#c86bb6', '#3cb6c2', '#c79a4e'];
export const COR_SEM_ROTA = '#6b7378';

/** Cor do i-ésimo sentido da linha, no mapa e no painel. */
export function corDoSentido(i: number, tema: Tema): string {
  const cores = tema === 'noite' ? CORES_NOITE : CORES_DIA;
  return cores[i % cores.length];
}

const NATAL: L.LatLngTuple = [-5.7945, -35.211];
const ATRIBUICAO = 'Mapa &copy; Esri, HERE, Garmin, &copy; OpenStreetMap';

/** Mapas-base da Esri (sem chave de API): fundo sem rótulos + camada de nomes por cima. */
function esri(servico: string): L.TileLayer {
  return L.tileLayer(
    `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${servico}/MapServer/tile/{z}/{y}/{x}`,
    // Acima do zoom 16 a Esri não tem tiles: amplia os do 16.
    { maxNativeZoom: 16, maxZoom: 19, attribution: ATRIBUICAO },
  );
}

const SETA_SVG =
  '<svg class="seta" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 19 18 12 14.5 5 18Z"/></svg>';

interface Marcador {
  marker: L.Marker;
  texto: string;
  /** Elemento DOM atual (o Leaflet o recria se a camada for desligada e religada). */
  el?: HTMLElement;
  seta?: SVGElement | null;
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
  readonly tema = input<Tema>('dia');
  readonly selecionado = input<string | null>(null);
  readonly pontos = input<PontoFisico[]>([]);
  readonly pontoSelecionado = input<string | null>(null);
  readonly minhaPosicao = input<Posicao | null>(null);
  readonly onibusClicado = output<string>();
  readonly pontoClicado = output<string>();

  private readonly tiles: Record<Tema, L.LayerGroup> = {
    noite: L.layerGroup([esri('World_Dark_Gray_Base'), esri('World_Dark_Gray_Reference')]),
    dia: L.layerGroup([esri('World_Light_Gray_Base'), esri('World_Light_Gray_Reference')]),
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
  private readonly marcadoresPonto = new Map<string, L.Marker>();
  private eu?: L.Marker;
  private frota = new Frota();
  private linhaAtual: Linha | null = null;
  private assinaturaTracado = '';
  private assinaturaPontos = '';
  private limitesTracado?: L.LatLngBounds;
  private enquadrou = false;
  private cores = new Map<string, string>();
  private raf = 0;

  constructor() {
    effect(() => {
      const dados = this.dados();
      if (this.mapa) this.aplicar(dados);
    });
    effect(() => {
      const tema = this.tema();
      if (this.mapa) this.aplicarTema(tema);
    });
    effect(() => {
      const pontos = this.pontos();
      if (this.mapa) this.desenharPontos(pontos);
    });
    effect(() => {
      const id = this.selecionado();
      for (const [chave, m] of this.marcadores)
        m.marker.getElement()?.classList.toggle('selecionado', chave === id);
    });
    effect(() => {
      const sel = this.pontoSelecionado();
      for (const [chave, m] of this.marcadoresPonto) {
        const ativo = chave === sel;
        m.getElement()?.classList.toggle('ativo', ativo);
        m.setZIndexOffset(ativo ? 500 : 0);
      }
    });
    effect(() => {
      const pos = this.minhaPosicao();
      if (this.mapa) this.desenharEu(pos);
    });
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.raf));
  }

  aoCarregar(mapa: L.Map): void {
    this.mapa = mapa;
    this.aplicarTema(this.tema());
    L.control
      .zoom({ position: 'bottomright', zoomInTitle: 'Aproximar', zoomOutTitle: 'Afastar' })
      .addTo(mapa);
    mapa.attributionControl.setPrefix(false);
    this.camadaTracado.addTo(mapa);
    this.camadaParadas.addTo(mapa);
    this.camadaOnibus.addTo(mapa);
    this.aplicar(this.dados());
    this.desenharPontos(this.pontos());
    this.desenharEu(this.minhaPosicao());
    this.loop();
  }

  /** Centraliza o mapa num ônibus. */
  focar(id: string): void {
    const m = this.marcadores.get(id);
    if (m && this.mapa) this.mapa.flyTo(m.marker.getLatLng(), Math.max(this.mapa.getZoom(), 16));
  }

  /** Leva o mapa até um ponto (parada, posição do passageiro). */
  irPara(lat: number, lng: number): void {
    this.mapa?.flyTo([lat, lng], Math.max(this.mapa.getZoom(), 16));
  }

  /** Volta a mostrar o traçado inteiro da linha. */
  enquadrar(): void {
    if (this.limitesTracado?.isValid())
      this.mapa?.flyToBounds(this.limitesTracado, { padding: [48, 48] });
  }

  /** Itinerário (sentido) inferido de cada ônibus pelo dead reckoning. */
  sentidos(): Map<string, string | null> {
    return new Map(
      [...this.frota.onibus].map(([id, o]) => [id, o.posicaoNaRota()?.codigo ?? null]),
    );
  }

  /** Ônibus a caminho de uma parada, com estimativa de chegada. */
  previsoes(sel: ParadaNoSentido): Previsao[] {
    const it = this.linhaAtual?.itinerarios.find((i) => i.codigo === sel.itinerario);
    return it ? preverChegadas(this.frota, it.codigo, it.paradas, sel.parada.codigo) : [];
  }

  /** Rumo do traçado na parada, para a seta da placa (graus, 0 = norte). */
  rumo(sel: ParadaNoSentido): number | null {
    const it = this.linhaAtual?.itinerarios.find((i) => i.codigo === sel.itinerario);
    return it ? rumoNaParada(this.frota, it.codigo, it.paradas, sel.parada.codigo) : null;
  }

  private aplicarTema(tema: Tema): void {
    if (!this.mapa) return;
    for (const [nome, camada] of Object.entries(this.tiles)) {
      if (nome === tema) camada.addTo(this.mapa);
      else camada.remove();
    }
    // O contorno do traçado acompanha o chão do mapa.
    this.assinaturaTracado = '';
    if (this.linhaAtual) this.desenharTracado(this.linhaAtual);
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
      m.texto = o.velocidadeKmh === null ? o.id : `${o.id} – ${o.velocidadeKmh} km/h`;
      const rotulo = m.el?.querySelector('.rotulo');
      if (rotulo) rotulo.textContent = m.texto;
    }
  }

  private desenharTracado(linha: Linha): void {
    const assinatura = linha.itinerarios.map((i) => `${i.codigo}:${i.tracado.length}`).join(';');
    if (assinatura === this.assinaturaTracado) return;
    this.assinaturaTracado = assinatura;

    this.camadaTracado.clearLayers();
    this.cores = new Map(
      linha.itinerarios.map((it, i) => [it.codigo, corDoSentido(i, this.tema())]),
    );
    const contorno = this.tema() === 'noite' ? '#111416' : '#ffffff';

    const limites = L.latLngBounds([]);
    for (const it of linha.itinerarios) {
      if (it.tracado.length < 2) continue;
      const cor = this.cores.get(it.codigo)!;
      // Contorno + linha, como nos mapas de rota impressos (sem brilho).
      L.polyline(it.tracado, {
        color: contorno,
        weight: 8,
        opacity: 0.9,
        interactive: false,
      }).addTo(this.camadaTracado);
      const linhaMapa = L.polyline(it.tracado, {
        color: cor,
        weight: 4,
        opacity: 1,
        interactive: false,
      }).addTo(this.camadaTracado);
      limites.extend(linhaMapa.getBounds());
    }
    this.limitesTracado = limites;
    // Enquadra só ao abrir a linha (não a cada troca de tema).
    if (!this.enquadrou && limites.isValid()) {
      this.enquadrou = true;
      this.mapa?.fitBounds(limites, { padding: [48, 48] });
    }
  }

  private desenharPontos(pontos: PontoFisico[]): void {
    const assinatura = pontos.map((p) => p.chave).join(';');
    if (assinatura === this.assinaturaPontos) return;
    this.assinaturaPontos = assinatura;
    this.camadaParadas.clearLayers();
    this.marcadoresPonto.clear();

    const sel = this.pontoSelecionado();
    for (const p of pontos) {
      // Ícone de 44 px (alvo de toque) com o desenho da parada no centro.
      const marker = L.marker([p.lat, p.lng], {
        icon: L.divIcon({
          className: 'ponto-icone',
          html: '<span class="ponto-mapa"></span>',
          iconSize: [44, 44],
        }),
        title: p.nome,
        keyboard: false,
        zIndexOffset: p.chave === sel ? 500 : 0,
      })
        .on('click', () => this.pontoClicado.emit(p.chave))
        .addTo(this.camadaParadas);
      marker.getElement()?.classList.toggle('ativo', p.chave === sel);
      this.marcadoresPonto.set(p.chave, marker);
    }
  }

  private desenharEu(pos: Posicao | null): void {
    if (!this.mapa) return;
    if (!pos) {
      this.eu?.remove();
      return;
    }
    if (!this.eu) {
      this.eu = L.marker([pos.lat, pos.lng], {
        icon: L.divIcon({
          className: 'eu-icone',
          html: '<div class="eu"></div>',
          iconSize: [0, 0],
        }),
        keyboard: false,
        interactive: false,
        zIndexOffset: -100,
      });
    }
    this.eu.setLatLng([pos.lat, pos.lng]).addTo(this.mapa);
  }

  private criarMarcador(id: string, lat: number, lng: number): Marcador {
    const icone = L.divIcon({
      className: 'onibus-icone',
      html: `<div class="onibus"><div class="corpo">${SETA_SVG}</div><div class="rotulo"></div></div>`,
      iconSize: [0, 0],
    });
    const marker = L.marker([lat, lng], {
      icon: icone,
      keyboard: false,
      riseOnHover: true,
      zIndexOffset: 1000,
    })
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
        m.seta = el?.querySelector<SVGElement>('.seta');
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
        m.el?.classList.add('com-rumo');
        m.ultimoRumo = q.rumo;
      }
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private limpar(): void {
    this.camadaTracado.clearLayers();
    this.camadaOnibus.clearLayers();
    this.marcadores.clear();
    this.frota = new Frota();
    this.linhaAtual = null;
    this.assinaturaTracado = '';
    this.limitesTracado = undefined;
    this.enquadrou = false;
  }
}
