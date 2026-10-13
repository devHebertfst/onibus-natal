import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BancoModule } from './banco/banco.module.js';
import { LinhasModule } from './linhas/linhas.module.js';
import { ParadasModule } from './paradas/paradas.module.js';
import { TrajetosModule } from './trajetos/trajetos.module.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BancoModule,
    LinhasModule,
    ParadasModule,
    TrajetosModule,
  ],
})
export class AppModule {}
