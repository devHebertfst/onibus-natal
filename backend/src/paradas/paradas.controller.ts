import { Controller, Get, Param, ParseFloatPipe, Query } from '@nestjs/common';
import type { ParadaProximaDto, PrevisaoParadaDto } from './paradas.dto.js';
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

  /** Paradas dentro da parte visível do mapa (tela inicial, sem linha aberta). */
  @Get('area')
  area(
    @Query('sul', ParseFloatPipe) sul: number,
    @Query('oeste', ParseFloatPipe) oeste: number,
    @Query('norte', ParseFloatPipe) norte: number,
    @Query('leste', ParseFloatPipe) leste: number,
  ): Promise<ParadaProximaDto[]> {
    return this.paradas.naArea(sul, oeste, norte, leste);
  }

  /** Próximos ônibus de cada linha que passa na parada. */
  @Get(':codigo/previsao')
  previsao(@Param('codigo') codigo: string): Promise<PrevisaoParadaDto> {
    return this.paradas.previsoes(codigo);
  }
}
