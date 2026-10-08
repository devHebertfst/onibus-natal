import { Module } from '@nestjs/common';
import { NubusClient } from './nubus.client.js';

/** Um só cliente da API de transporte para o app inteiro (e um só ponto para os testes trocarem). */
@Module({
  providers: [NubusClient],
  exports: [NubusClient],
})
export class NubusModule {}
