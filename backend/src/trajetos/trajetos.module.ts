import { Module } from '@nestjs/common';
import { NubusModule } from '../nubus/nubus.module.js';
import { ParadasModule } from '../paradas/paradas.module.js';
import { TrajetosController } from './trajetos.controller.js';
import { TrajetosService } from './trajetos.service.js';

@Module({
  imports: [NubusModule, ParadasModule],
  controllers: [TrajetosController],
  providers: [TrajetosService],
})
export class TrajetosModule {}
