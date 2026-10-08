import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { LinhasModule } from './linhas/linhas.module.js';
import { ParadasModule } from './paradas/paradas.module.js';
import { TrajetosModule } from './trajetos/trajetos.module.js';

@Module({
  imports: [ScheduleModule.forRoot(), LinhasModule, ParadasModule, TrajetosModule],
})
export class AppModule {}
