import { Controller, Get } from '@nestjs/common';
import { RelogioGps, type ResumoAtraso } from '../nubus/relogio-gps.js';
import { LinhasService, type ResumoTrechos } from './linhas.service.js';

/**
 * Números para avaliar a precisão com a API real: quanto as posições chegam
 * atrasadas (GPS → Nubus → poll), quanto está sendo descontado delas e quanto
 * de cada traçado já tem velocidade por trecho medida.
 */
@Controller('diagnostico')
export class DiagnosticoController {
  constructor(
    private readonly relogio: RelogioGps,
    private readonly linhas: LinhasService,
  ) {}

  @Get()
  resumo(): {
    atrasoGps: ResumoAtraso;
    linhasAcompanhadas: number;
    trechos: ResumoTrechos[];
  } {
    return {
      atrasoGps: this.relogio.resumo(),
      linhasAcompanhadas: this.linhas.acompanhadas().length,
      trechos: this.linhas.resumoTrechos(),
    };
  }
}
