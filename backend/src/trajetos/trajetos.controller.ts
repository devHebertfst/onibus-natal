import { Controller, Get, ParseFloatPipe, Query } from '@nestjs/common';
import { TrajetosService } from './trajetos.service.js';

@Controller('trajetos')
export class TrajetosController {
  constructor(private readonly trajetos: TrajetosService) {}

  @Get()
  planejar(
    @Query('from_lat', ParseFloatPipe) fromLat: number,
    @Query('from_lng', ParseFloatPipe) fromLng: number,
    @Query('to_lat', ParseFloatPipe) toLat: number,
    @Query('to_lng', ParseFloatPipe) toLng: number,
    @Query('datetime') datetime?: string,
  ) {
    return this.trajetos.planejar(fromLat, fromLng, toLat, toLng, datetime);
  }
}
