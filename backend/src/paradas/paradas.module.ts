import { Module } from '@nestjs/common';
import { NubusModule } from '../nubus/nubus.module.js';
import { ParadasController } from './paradas.controller.js';
import { ParadasService } from './paradas.service.js';

@Module({
  imports: [NubusModule],
  controllers: [ParadasController],
  providers: [ParadasService],
  exports: [ParadasService],
})
export class ParadasModule {}
