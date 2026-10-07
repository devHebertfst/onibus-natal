import { Itinerario, Linha } from '../../core/linha.models';
import { OnibusAnimado } from './onibus-animado';
import { Rota } from './rota';

/**
 * Conjunto dos ônibus animados de uma linha. Converte cada resposta do backend
 * em atualizações dos `OnibusAnimado`, sem depender do Leaflet.
 */
export class Frota {
  readonly onibus = new Map<string, OnibusAnimado>();
  private rotas = new Map<string, Rota>();
  private assinaturaRotas = '';

  /** Traçado já preparado de um itinerário. */
  rota(codigo: string): Rota | undefined {
    return this.rotas.get(codigo);
  }

  /** Aplica uma resposta do backend. Devolve os ids que sumiram. */
  sincronizar(linha: Linha, recebidoEm: number, agora = recebidoEm): string[] {
    this.definirRotas(linha.itinerarios);

    // A API não tem horário de GPS; usamos "há quanto tempo o backend vê esta
    // posição", no relógio do servidor, e trazemos para o relógio do navegador.
    const agoraServidor = Date.parse(linha.atualizadoEm);
    const vistos = new Set<string>();

    for (const o of linha.onibus) {
      vistos.add(o.id);
      let animado = this.onibus.get(o.id);
      if (!animado) {
        animado = new OnibusAnimado(o.id);
        this.onibus.set(o.id, animado);
      }
      const idade = Math.max(0, agoraServidor - Date.parse(o.posicaoDesde));
      const candidatas = o.itinerarios
        .map((c) => this.rotas.get(c))
        .filter((r): r is Rota => r !== undefined);
      animado.atualizar(
        [o.lat, o.lng],
        o.velocidadeKmh,
        recebidoEm - idade,
        candidatas.length > 0 ? candidatas : [...this.rotas.values()],
        agora,
      );
    }

    const removidos = [...this.onibus.keys()].filter((id) => !vistos.has(id));
    for (const id of removidos) this.onibus.delete(id);
    return removidos;
  }

  private definirRotas(itinerarios: Itinerario[]): void {
    const assinatura = itinerarios
      .map((i) => `${i.codigo}:${i.tracado.length}:${i.tracado[0]}:${i.tracado.at(-1)}`)
      .join(';');
    if (assinatura === this.assinaturaRotas) return;

    this.assinaturaRotas = assinatura;
    this.rotas = new Map(
      itinerarios
        .filter((i) => i.tracado.length >= 2)
        .map((i) => [i.codigo, new Rota(i.codigo, i.tracado)]),
    );
    for (const o of this.onibus.values()) o.esquecerRota();
  }
}
