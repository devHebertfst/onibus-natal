import { Global, Module } from '@nestjs/common';
import { CachePersistente } from './cache-persistente.js';

/** O que fica guardado no Postgres, disponível para todos os módulos. */
@Global()
@Module({
  providers: [CachePersistente],
  exports: [CachePersistente],
})
export class BancoModule {}
