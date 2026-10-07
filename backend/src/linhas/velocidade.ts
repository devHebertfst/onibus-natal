import { config } from '../config.js';
import { haversine, LatLng } from './geo.js';

/** Uma posição GPS nova, carimbada com o instante em que o backend a viu. */
interface Fix extends LatLng {
  t: number;
}

interface Historico {
  fixes: Fix[];
  vistoEm: number;
}

export type ParametrosVelocidade = typeof config.velocidade;

/**
 * Estima a velocidade de cada veículo como média do caminho percorrido numa
 * janela móvel (~90s): soma das distâncias Haversine entre posições
 * consecutivas ÷ tempo decorrido. Isso suaviza a oscilação que apareceria se
 * a velocidade fosse calculada só entre as duas últimas posições.
 *
 * Observação: a API não informa o horário do GPS, então usamos o instante em
 * que o backend percebeu a mudança de posição. Com poll de 15s e GPS de
 * 20-30s, o erro de cada carimbo é de até 15s, diluído pela janela de 90s.
 */
export class RastreadorVelocidade {
  private readonly veiculos = new Map<string, Historico>();

  constructor(private readonly p: ParametrosVelocidade = config.velocidade) {}

  /** Registra a posição atual reportada para o veículo. */
  registrar(id: string, pos: LatLng, agora: number): void {
    let h = this.veiculos.get(id);
    if (!h) {
      h = { fixes: [], vistoEm: agora };
      this.veiculos.set(id, h);
    }
    h.vistoEm = agora;

    const ultimo = h.fixes.at(-1);
    if (!ultimo) {
      h.fixes.push({ ...pos, t: agora });
      return;
    }

    const d = haversine(ultimo, pos);
    // Mesma posição (GPS ainda não atualizou) ou ruído: não é movimento.
    if (d < this.p.ruidoMinimoM) return;

    const dt = (agora - ultimo.t) / 1000;
    const kmhImplicita = dt > 0 ? (d / dt) * 3.6 : Infinity;
    if (kmhImplicita > this.p.velocidadeMaximaKmh) {
      // Salto impossível (erro de GPS ou veículo trocou de linha): recomeça.
      h.fixes = [{ ...pos, t: agora }];
      return;
    }

    h.fixes.push({ ...pos, t: agora });
    this.podar(h, agora);
  }

  /** Velocidade média na janela, em km/h. */
  velocidadeKmh(id: string, agora: number): number {
    const fixes = this.veiculos.get(id)?.fixes;
    if (!fixes || fixes.length < 2) return 0;

    const ultimo = fixes[fixes.length - 1];
    if (agora - ultimo.t > this.p.paradoAposMs) return 0;

    const inicio = this.indiceInicioJanela(fixes, agora);
    if (fixes.length - inicio < 2) return 0;

    let distancia = 0;
    for (let i = inicio + 1; i < fixes.length; i++) {
      distancia += haversine(fixes[i - 1], fixes[i]);
    }
    const segundos = (ultimo.t - fixes[inicio].t) / 1000;
    return segundos > 0 ? (distancia / segundos) * 3.6 : 0;
  }

  /** Instante (ms) em que a posição atual do veículo foi vista pela 1ª vez. */
  posicaoDesde(id: string): number | undefined {
    return this.veiculos.get(id)?.fixes.at(-1)?.t;
  }

  /** Remove veículos que sumiram da API há muito tempo. */
  esquecerAntigos(agora: number): void {
    for (const [id, h] of this.veiculos) {
      if (agora - h.vistoEm > this.p.esquecerAposMs) this.veiculos.delete(id);
    }
  }

  /**
   * Primeiro fix usado na média: o mais antigo dentro da janela, ou o último
   * antes dela (âncora), para que a janela cubra ~90s e não só os fixes que
   * caíram inteiros nela.
   */
  private indiceInicioJanela(fixes: Fix[], agora: number): number {
    const limite = agora - this.p.janelaMs;
    let i = fixes.length - 1;
    while (i > 0 && fixes[i - 1].t >= limite) i--;
    return i > 0 ? i - 1 : 0;
  }

  private podar(h: Historico, agora: number): void {
    const inicio = this.indiceInicioJanela(h.fixes, agora);
    if (inicio > 0) h.fixes.splice(0, inicio);
    // A âncora só vale se não for velha demais; senão a média fica diluída
    // por uma longa parada anterior.
    if (h.fixes.length > 1 && agora - h.fixes[0].t > 2 * this.p.janelaMs) {
      h.fixes.shift();
    }
  }
}
