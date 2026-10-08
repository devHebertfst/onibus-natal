import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config.js';
import type {
  NubusItinerario,
  NubusParadaCidade,
  NubusParadasEspecifica,
  NubusPrevisao,
} from './nubus.types.js';

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

  /**
   * Paradas, traçado e posição dos ônibus de um itinerário. Sem `carros`, a
   * resposta vem sem os ônibus (para quem só quer as paradas).
   */
  async paradasEspecifica(
    codigoItinerario: string,
    carros = true,
  ): Promise<NubusParadasEspecifica> {
    const dados = await this.post<
      NubusParadasEspecifica[] | NubusParadasEspecifica | null
    >('/previsoes/ListaParadasEspecificaV2', {
      cidade: config.nubus.cidade,
      itinerario: codigoItinerario,
      carro: String(carros),
    });
    // Normalmente `[{ itinerario, paradas, pontos, carros }]`; aceita também
    // o objeto solto, por segurança.
    return (Array.isArray(dados) ? dados[0] : dados) ?? {};
  }

  /**
   * Todas as paradas da cidade. A API pede uma posição e um zoom, mas
   * devolve a lista inteira (~1800) qualquer que seja a posição.
   */
  async listarParadas(): Promise<NubusParadaCidade[]> {
    const dados = await this.post<unknown>('/previsoes/listaparadasv2', {
      cidade: config.nubus.cidade,
      latitude: '-5.79',
      longitude: '-35.21',
      zoom: '15',
    });
    if (!Array.isArray(dados)) {
      throw new NubusError('listaparadasv2: resposta não é uma lista');
    }
    return dados as NubusParadaCidade[];
  }

  /**
   * Previsão de chegada da própria Nubus numa parada de um itinerário. Pede
   * a descrição do itinerário (não o código) e a parada com o prefixo da
   * operadora: as 3 primeiras letras do `codigolinha` ("CDN" + "PARADA#…").
   * O `sentido` é obrigatório, mas não muda a resposta.
   */
  async previsaoParada(
    codigolinha: string,
    descricaoItinerario: string,
    codigoParada: string,
  ): Promise<NubusPrevisao[]> {
    const dados = await this.post<unknown>('/previsoes/paradas', {
      cidade: config.nubus.cidade,
      sentido: '1',
      linha: codigolinha,
      itinerario: descricaoItinerario,
      parada: codigolinha.slice(0, 3) + codigoParada,
    });
    if (dados === null) return [];
    if (!Array.isArray(dados)) {
      throw new NubusError('paradas: resposta não é uma lista');
    }
    return dados as NubusPrevisao[];
  }

  async planejarTrajeto(
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number,
    datetime: string,
  ): Promise<unknown> {
    const parametros = new URLSearchParams({
      from_lat: String(fromLat),
      from_lng: String(fromLng),
      to_lat: String(toLat),
      to_lng: String(toLng),
      datetime,
      type: 'departure',
    });
    return this.requisitar('/get-paths', { method: 'GET' }, parametros);
  }

  private post<T>(caminho: string, corpo: object): Promise<T> {
    return this.requisitar<T>(caminho, {
      method: 'POST',
      body: JSON.stringify(corpo),
    });
  }

  private async requisitar<T>(
    caminho: string,
    opcoes: RequestInit,
    parametros = new URLSearchParams(),
  ): Promise<T> {
    parametros.set('city', config.nubus.cidade);
    const url = `${config.nubus.baseUrl}${caminho}?${parametros}`;
    let resposta: Response;
    try {
      resposta = await fetch(url, {
        ...opcoes,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          version: config.nubus.version,
        },
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
