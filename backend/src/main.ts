import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { config } from './config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  // Em dev o Angular usa proxy (frontend/proxy.conf.json); o CORS cobre
  // acesso direto, ex.: frontend servido de outro domínio.
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true });
  app.enableShutdownHooks();
  await app.listen(config.port);
}
await bootstrap();
