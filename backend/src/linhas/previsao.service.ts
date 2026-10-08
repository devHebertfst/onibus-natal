import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { config } from '../config.js';
import { NubusClient } from '../nubus/nubus.client.js';
import { parsePrevisoes } from '../nubus/nubus.parse.js';
import type { PrevisaoDto } from './linha.dto.js';
import { LinhasService } from './linhas.service.js';

/** Viagens da tabela além dos ônibus ao vivo: as próximas bastam. */
const MAX_PROGRAMADAS = 3;
/** Entradas de cache esquecidas depois desse tempo sem uso. */
const ESQUECER_APOS_MS = 5 * 60_000;

interface ItemCache {
  em: number;
  valor?: PrevisaoDto;
  emAndamento?: Promise<PrevisaoDto>;
}

/**
 * Previsão de chegada da própria Nubus numa parada. Cada parada é consultada
 * no máximo uma vez a cada 15s, por mais gente que a esteja olhando.
 */
@Injectable()
export class PrevisaoService {
  private readonly cache = new Map<string, ItemCache>();

  constructor(
    private readonly linhas: LinhasService,
    private readonly nubus: NubusClient,
  ) {}

  async obter(
    numero: string,
    itinerario: string,
    parada: string,
  ): Promise<PrevisaoDto> {
    if (!itinerario || !parada) {
      throw new BadRequestException('Informe o itinerário e a parada');
    }
    // Só paradas que existem no itinerário: o cache não cresce com lixo.
    const linha = await this.linhas.obter(numero);
    const it = linha.itinerarios.find((i) => i.codigo === itinerario);
    if (!it?.paradas.some((p) => p.codigo === parada)) {
      throw new NotFoundException('Parada não é deste itinerário');
    }
    const ref = await this.linhas.itinerario(numero, itinerario);

    const agora = Date.now();
    this.esquecerAntigos(agora);
    const chave = `${ref.codigo}|${parada}`;
    const item = this.cache.get(chave);
    if (item?.emAndamento) return item.emAndamento;
    if (item?.valor && agora - item.em < config.previsaoTtlMs)
      return item.valor;

    const novo: ItemCache = { em: item?.em ?? agora, valor: item?.valor };
    novo.emAndamento = this.consultar(ref, parada).finally(() => {
      novo.emAndamento = undefined;
    });
    this.cache.set(chave, novo);
    const valor = await novo.emAndamento;
    novo.valor = valor;
    novo.em = Date.now();
    return valor;
  }

  private async consultar(
    ref: { codigo: string; descricao: string; codigolinha: string },
    parada: string,
  ): Promise<PrevisaoDto> {
    if (!ref.codigolinha) {
      throw new NotFoundException('Sem previsão para este itinerário');
    }
    let brutas;
    try {
      brutas = await this.nubus.previsaoParada(
        ref.codigolinha,
        ref.descricao,
        parada,
      );
    } catch (e) {
      throw new BadGatewayException(
        `Previsão indisponível: ${(e as Error).message}`,
      );
    }
    const agora = Date.now();
    const chegadas = parsePrevisoes(brutas, agora);
    const programadas = chegadas
      .filter((c) => !c.aoVivo && c.chegaEm > agora)
      .slice(0, MAX_PROGRAMADAS);
    return {
      itinerario: ref.codigo,
      parada,
      consultadoEm: new Date(agora).toISOString(),
      chegadas: [...chegadas.filter((c) => c.aoVivo), ...programadas]
        .sort((a, b) => a.chegaEm - b.chegaEm)
        .map((c) => ({
          onibus: c.onibus,
          aoVivo: c.aoVivo,
          chegaEm: new Date(c.chegaEm).toISOString(),
          metros: c.metros,
          gpsEm: c.gpsEm === null ? null : new Date(c.gpsEm).toISOString(),
        })),
    };
  }

  private esquecerAntigos(agora: number): void {
    for (const [chave, item] of this.cache) {
      if (!item.emAndamento && agora - item.em > ESQUECER_APOS_MS)
        this.cache.delete(chave);
    }
  }
}
