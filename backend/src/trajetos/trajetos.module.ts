import { Module } from '@nestjs/common';
import { NubusModule } from '../nubus/nubus.module.js';
import { TrajetosController } from './trajetos.controller.js';
import { TrajetosService } from './trajetos.service.js';

@Module({
  imports: [NubusModule],
  controllers: [TrajetosController],
  providers: [TrajetosService],
})
export class TrajetosModule {}
