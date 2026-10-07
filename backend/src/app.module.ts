import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { LinhasModule } from './linhas/linhas.module.js';

@Module({
  imports: [ScheduleModule.forRoot(), LinhasModule],
})
export class AppModule {}
