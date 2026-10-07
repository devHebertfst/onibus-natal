import { Controller, Get, Param } from '@nestjs/common';
import type { LinhaDto } from './linha.dto.js';
import { LinhasService } from './linhas.service.js';

@Controller('linhas')
export class LinhasController {
  constructor(private readonly linhas: LinhasService) {}

  /** Linhas que o backend está acompanhando agora. */
  @Get()
  listar(): string[] {
    return this.linhas.acompanhadas();
  }

  /** Ônibus (com posição e velocidade), paradas e traçado de uma linha. */
  @Get(':numero')
  obter(@Param('numero') numero: string): Promise<LinhaDto> {
    return this.linhas.obter(numero);
  }
}
