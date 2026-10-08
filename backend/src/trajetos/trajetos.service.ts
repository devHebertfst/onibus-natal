import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { NubusClient } from '../nubus/nubus.client.js';
import { coordenadaValida } from '../nubus/nubus.parse.js';
import { parseTrajetos } from './trajeto.parse.js';
import type { TrajetoDto } from './trajeto.dto.js';

/** Data/hora de Natal para o endpoint, independente do fuso do servidor. */
export function dataNatal(ms: number): string {
  return new Date(ms - 3 * 60 * 60_000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

@Injectable()
export class TrajetosService {
  constructor(private readonly nubus: NubusClient) {}

  async planejar(
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number,
    datetime?: string,
  ): Promise<TrajetoDto> {
    if (!coordenadaValida(fromLat, fromLng) || !coordenadaValida(toLat, toLng))
      throw new BadRequestException('Informe origem e destino válidos');
    const data =
      datetime === undefined
        ? dataNatal(Date.now())
        : datetime.replace('T', ' ');
    const completa = data.length === 16 ? `${data}:00` : data;
    const ms = Date.parse(completa.replace(' ', 'T') + '-03:00');
    if (
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(completa) ||
      !Number.isFinite(ms) ||
      dataNatal(ms) !== completa
    )
      throw new BadRequestException('Informe uma data e hora válidas de Natal');
    try {
      const dados = await this.nubus.planejarTrajeto(
        fromLat,
        fromLng,
        toLat,
        toLng,
        completa,
      );
      return {
        consultadoEm: new Date().toISOString(),
        viagens: parseTrajetos(dados),
      };
    } catch (e) {
      throw new BadGatewayException(
        `Planejador indisponível: ${(e as Error).message}`,
      );
    }
  }
}
