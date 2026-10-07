import { Module } from '@nestjs/common';
import { NubusClient } from '../nubus/nubus.client.js';
import { LinhasController } from './linhas.controller.js';
import { LinhasService } from './linhas.service.js';

@Module({
  controllers: [LinhasController],
  providers: [LinhasService, NubusClient],
})
export class LinhasModule {}
