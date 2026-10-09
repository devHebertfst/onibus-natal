import { Controller, Get } from '@nestjs/common';
import { RelogioGps, type ResumoAtraso } from '../nubus/relogio-gps.js';
import { LinhasService } from './linhas.service.js';

/**
 * Números para avaliar a precisão com a API real: quanto as posições chegam
 * atrasadas (GPS → Nubus → poll) e quanto está sendo descontado delas.
 */
@Controller('diagnostico')
export class DiagnosticoController {
  constructor(
    private readonly relogio: RelogioGps,
    private readonly linhas: LinhasService,
  ) {}

  @Get()
  resumo(): { atrasoGps: ResumoAtraso; linhasAcompanhadas: number } {
    return {
      atrasoGps: this.relogio.resumo(),
      linhasAcompanhadas: this.linhas.acompanhadas().length,
    };
  }
}
