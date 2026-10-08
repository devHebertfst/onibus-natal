import { Controller, Get, ParseFloatPipe, Query } from '@nestjs/common';
import type { ParadaProximaDto } from './paradas.dto.js';
import { ParadasService } from './paradas.service.js';

@Controller('paradas')
export class ParadasController {
  constructor(private readonly paradas: ParadasService) {}

  /** Paradas perto de uma posição, com as linhas que passam em cada uma. */
  @Get('proximas')
  proximas(
    @Query('lat', ParseFloatPipe) lat: number,
    @Query('lng', ParseFloatPipe) lng: number,
    @Query('raio') raio?: string,
  ): Promise<ParadaProximaDto[]> {
    return this.paradas.proximas(
      lat,
      lng,
      raio === undefined ? undefined : Number(raio),
    );
  }
}
