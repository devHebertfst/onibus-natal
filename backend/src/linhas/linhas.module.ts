import { Module } from '@nestjs/common';
import { NubusModule } from '../nubus/nubus.module.js';
import { DiagnosticoController } from './diagnostico.controller.js';
import { LinhasController } from './linhas.controller.js';
import { LinhasService } from './linhas.service.js';
import { PrevisaoService } from './previsao.service.js';

@Module({
  imports: [NubusModule],
  controllers: [LinhasController, DiagnosticoController],
  providers: [LinhasService, PrevisaoService],
})
export class LinhasModule {}
