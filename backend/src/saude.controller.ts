import { Controller, Get, Header } from '@nestjs/common';

/**
 * Rota mínima para o ping que mantém o servidor acordado (cron-job.org):
 * responde "ok" sem tocar em nada, e com poucos bytes (o cron aborta
 * respostas grandes).
 */
@Controller('saude')
export class SaudeController {
  @Get()
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  ok(): string {
    return 'ok';
  }
}
