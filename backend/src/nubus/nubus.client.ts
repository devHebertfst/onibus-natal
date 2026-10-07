import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config.js';
import type { NubusItinerario, NubusParadasEspecifica } from './nubus.types.js';

export class NubusError extends Error {}

/**
 * Cliente HTTP da API Nubus. Única classe que fala com a API externa: os
 * testes substituem este provider por um fake.
 */
@Injectable()
export class NubusClient {
  private readonly logger = new Logger(NubusClient.name);

  /** Lista os itinerários (ida, volta, variantes) de uma linha. */
  async pesquisarRotas(numeroLinha: string): Promise<NubusItinerario[]> {
    const dados = await this.post<unknown>('/previsoes/PesquisaRotas', {
      cidade: config.nubus.cidade,
      itinerario: numeroLinha,
    });
    if (!Array.isArray(dados)) {
      throw new NubusError('PesquisaRotas: resposta não é uma lista');
    }
    return dados as NubusItinerario[];
  }

  /** Paradas, traçado e posição dos ônibus de um itinerário. */
  async paradasEspecifica(
    codigoItinerario: string,
  ): Promise<NubusParadasEspecifica> {
    const dados = await this.post<
      NubusParadasEspecifica[] | NubusParadasEspecifica | null
    >('/previsoes/ListaParadasEspecificaV2', {
      cidade: config.nubus.cidade,
      itinerario: codigoItinerario,
      carro: 'true',
    });
    // Normalmente `[{ itinerario, paradas, pontos, carros }]`; aceita também
    // o objeto solto, por segurança.
    return (Array.isArray(dados) ? dados[0] : dados) ?? {};
  }

  private async post<T>(caminho: string, corpo: object): Promise<T> {
    const url = `${config.nubus.baseUrl}${caminho}?city=${config.nubus.cidade}`;
    let resposta: Response;
    try {
      resposta = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          version: config.nubus.version,
        },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(config.nubus.timeoutMs),
      });
    } catch (e) {
      throw new NubusError(
        `${caminho}: falha de rede (${(e as Error).message})`,
      );
    }
    if (!resposta.ok) {
      throw new NubusError(`${caminho}: HTTP ${resposta.status}`);
    }
    const texto = await resposta.text();
    if (!texto) return null as T;
    try {
      return JSON.parse(texto) as T;
    } catch {
      this.logger.warn(`${caminho}: corpo não-JSON: ${texto.slice(0, 200)}`);
      throw new NubusError(`${caminho}: resposta inválida`);
    }
  }
}
