import { Module } from '@nestjs/common';
import { NubusClient } from './nubus.client.js';
import { CatalogoRotasService } from './catalogo-rotas.service.js';

/** Um só cliente da API de transporte para o app inteiro (e um só ponto para os testes trocarem). */
@Module({
  providers: [NubusClient, CatalogoRotasService],
  exports: [NubusClient, CatalogoRotasService],
})
export class NubusModule {}
