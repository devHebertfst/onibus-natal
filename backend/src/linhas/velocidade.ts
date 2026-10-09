import { config } from '../config.js';
import { haversine, LatLng } from './geo.js';

/** Uma posição GPS nova. */
interface Fix extends LatLng {
  /** Quando o GPS mediu a posição: a hora real, se conhecida, ou a estimada. */
  t: number;
  /** Quando o backend viu a posição pela 1ª vez. */
  visto: number;
  /** `t` é a hora real do GPS (e não uma estimativa). */
  gps: boolean;
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
 * Horário de cada posição: o traçado da API não informa quando o GPS a
 * mediu. Quem chama passa uma estimativa (hora em que o backend viu menos o
 * atraso típico medido) e, quando a previsão de chegada traz a hora real do
 * GPS daquele ônibus, `corrigir` troca a estimativa pela hora real.
 */
export class RastreadorVelocidade {
  private readonly veiculos = new Map<string, Historico>();

  constructor(private readonly p: ParametrosVelocidade = config.velocidade) {}

  /**
   * Registra a posição atual reportada para o veículo.
   * @param hora quando o GPS mediu a posição (estimada); padrão: `agora`.
   */
  registrar(id: string, pos: LatLng, agora: number, hora = agora): void {
    let h = this.veiculos.get(id);
    if (!h) {
      h = { fixes: [], vistoEm: agora };
      this.veiculos.set(id, h);
    }
    h.vistoEm = agora;

    const ultimo = h.fixes.at(-1);
    if (!ultimo) {
      h.fixes.push({
        ...pos,
        t: Math.min(hora, agora),
        visto: agora,
        gps: false,
      });
      return;
    }

    const d = haversine(ultimo, pos);
    // Mesma posição (GPS ainda não atualizou) ou ruído: não é movimento.
    if (d < this.p.ruidoMinimoM) return;

    // A hora estimada nunca volta para antes da posição anterior.
    const t = Math.max(ultimo.t + 1000, Math.min(hora, agora));
    const dt = (t - ultimo.t) / 1000;
    const kmhImplicita = dt > 0 ? (d / dt) * 3.6 : Infinity;
    if (kmhImplicita > this.p.velocidadeMaximaKmh) {
      // Salto impossível (erro de GPS ou veículo trocou de linha): recomeça.
      h.fixes = [{ ...pos, t, visto: agora, gps: false }];
      return;
    }

    h.fixes.push({ ...pos, t, visto: agora, gps: false });
    this.podar(h, agora);
  }

  /**
   * A previsão de chegada contou a hora real do GPS de uma posição do
   * veículo: troca a estimativa por ela. Devolve o atraso medido (quando o
   * backend viu − quando o GPS mediu), uma vez por posição, ou `undefined`
   * se essa posição não está no histórico ou já foi corrigida.
   */
  corrigir(id: string, pos: LatLng, gpsEm: number): number | undefined {
    const fixes = this.veiculos.get(id)?.fixes;
    if (!fixes) return undefined;
    for (let i = fixes.length - 1; i >= 0; i--) {
      const f = fixes[i];
      if (haversine(f, pos) >= this.p.mesmaPosicaoM) continue;
      if (f.gps) return undefined;
      // Mantém a ordem: entre a posição anterior e a seguinte.
      const min = i > 0 ? fixes[i - 1].t + 1000 : -Infinity;
      const max = i < fixes.length - 1 ? fixes[i + 1].t - 1000 : f.visto;
      f.t = Math.max(min, Math.min(gpsEm, max));
      f.gps = true;
      return f.visto - gpsEm;
    }
    return undefined;
  }

  /**
   * Velocidade média na janela, em km/h, ou `null` se ainda não dá para saber:
   * com uma só posição, o veículo pode estar parado ou o GPS (que atualiza a
   * cada ~30s) apenas não mudou ainda. Só depois de `paradoAposMs` na mesma
   * posição ele é considerado parado (0).
   */
  velocidadeKmh(id: string, agora: number): number | null {
    const fixes = this.veiculos.get(id)?.fixes;
    if (!fixes || fixes.length === 0) return null;
    // "Parado" conta de quando o backend viu a posição, não da hora do GPS:
    // o atraso da API não pode fazer um ônibus andando parecer parado.
    if (fixes.length < 2)
      return agora - fixes[0].visto > this.p.paradoAposMs ? 0 : null;

    const ultimo = fixes[fixes.length - 1];
    if (agora - ultimo.visto > this.p.paradoAposMs) return 0;

    const inicio = this.indiceInicioJanela(fixes, agora);
    if (fixes.length - inicio < 2) return 0;

    let distancia = 0;
    for (let i = inicio + 1; i < fixes.length; i++) {
      distancia += haversine(fixes[i - 1], fixes[i]);
    }
    const segundos = (ultimo.t - fixes[inicio].t) / 1000;
    return segundos > 0 ? (distancia / segundos) * 3.6 : 0;
  }

  /** Quando o GPS mediu a posição atual do veículo (real ou estimado). */
  posicaoDesde(id: string): number | undefined {
    return this.veiculos.get(id)?.fixes.at(-1)?.t;
  }

  /**
   * A posição anterior à atual. Quando a posição atual chega, quase sempre já
   * deu tempo de a hora real do GPS da anterior aparecer e corrigi-la: é a
   * mais recente com hora confiável.
   */
  posicaoAnterior(id: string): (LatLng & { t: number }) | undefined {
    return this.veiculos.get(id)?.fixes.at(-2);
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
