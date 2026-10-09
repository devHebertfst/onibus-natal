import { Controller, Get } from '@nestjs/common';
import {
  HistoricoTrechos,
  type ResumoHistorico,
} from '../historico/historico-trechos.js';
import { RelogioGps, type ResumoAtraso } from '../nubus/relogio-gps.js';
import { LinhasService, type ResumoTrechos } from './linhas.service.js';

/**
 * Números para avaliar a precisão com a API real: quanto as posições chegam
 * atrasadas (GPS → Nubus → poll), quanto está sendo descontado delas e quanto
 * de cada traçado já tem velocidade por trecho medida e se o histórico
 * está sendo gravado no banco.
 */
@Controller('diagnostico')
export class DiagnosticoController {
  constructor(
    private readonly relogio: RelogioGps,
    private readonly linhas: LinhasService,
    private readonly historico: HistoricoTrechos,
  ) {}

  @Get()
  resumo(): {
    atrasoGps: ResumoAtraso;
    linhasAcompanhadas: number;
    trechos: ResumoTrechos[];
    historico: ResumoHistorico;
  } {
    return {
      atrasoGps: this.relogio.resumo(),
      linhasAcompanhadas: this.linhas.acompanhadas().length,
      trechos: this.linhas.resumoTrechos(),
      historico: this.historico.resumo(),
    };
  }
}
