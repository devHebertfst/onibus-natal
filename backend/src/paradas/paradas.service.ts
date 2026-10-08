import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { config } from '../config.js';
import { haversine } from '../linhas/geo.js';
import { emParalelo, numeroDaLinha } from '../linhas/linhas.service.js';
import { NubusClient } from '../nubus/nubus.client.js';
import { CatalogoRotasService } from '../nubus/catalogo-rotas.service.js';
import {
  type ParadaCidade,
  parseParadas,
  parseParadasCidade,
} from '../nubus/nubus.parse.js';
import type { LinhaNaParadaDto, ParadaProximaDto } from './paradas.dto.js';

/** Raio máximo da busca (m): mais longe que isso não é "perto de mim". */
const RAIO_MAXIMO_M = 1_500;
const RAIO_PADRAO_M = 600;
const QUANTAS = 8;
/** Paradas devolvidas por área: o mapa só pede de perto, e mais que isso pesa no celular. */
const QUANTAS_AREA = 400;
/** Lado máximo da área (graus, ~55 km): mais que a Grande Natal não é "o que está no mapa". */
const LADO_MAXIMO_AREA = 0.5;
/** Quantos itinerários consultar em paralelo ao montar o índice. */
const CONCORRENCIA = 4;

interface Rede {
  paradas: ParadaCidade[];
  /** Código da parada → linhas que passam nela. */
  linhas: Map<string, LinhaNaParadaDto[]>;
  montadaEm: number;
}

/**
 * Paradas da cidade e quais linhas passam em cada uma. A API não tem esse
 * índice nem uma lista de linhas: a busca de rotas é por trecho, então
 * buscar "0" a "9" traz todas as que têm número (~120 itinerários), e as
 * paradas de cada itinerário dizem por onde ele passa. Montado uma vez por dia.
 */
@Injectable()
export class ParadasService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ParadasService.name);
  private rede?: Rede;
  private emAndamento?: Promise<Rede>;

  constructor(
    private readonly nubus: NubusClient,
    private readonly catalogo: CatalogoRotasService,
  ) {}

  onApplicationBootstrap(): void {
    if (!config.aquecerParadas) return;
    this.obterRede().catch((e: unknown) =>
      this.logger.warn(
        `Índice de paradas não montado: ${(e as Error).message}`,
      ),
    );
  }

  /** Paradas com ônibus perto de uma posição, da mais perto à mais longe. */
  async proximas(
    lat: number,
    lng: number,
    raio = RAIO_PADRAO_M,
  ): Promise<ParadaProximaDto[]> {
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      throw new BadRequestException('Posição inválida');
    }
    const limite = Math.min(
      Number.isFinite(raio) && raio > 0 ? raio : RAIO_PADRAO_M,
      RAIO_MAXIMO_M,
    );

    const rede = await this.obterRede();
    const aqui = { lat, lng };
    const resultado: ParadaProximaDto[] = [];
    for (const p of rede.paradas) {
      const linhas = rede.linhas.get(p.codigo);
      if (!linhas) continue; // parada sem nenhuma linha passando
      const metros = haversine(aqui, p);
      if (metros <= limite)
        resultado.push({ ...p, metros: Math.round(metros), linhas });
    }
    return resultado.sort((a, b) => a.metros - b.metros).slice(0, QUANTAS);
  }

  /**
   * Paradas com ônibus dentro de um retângulo (a parte visível do mapa), das
   * mais perto do centro às mais longe. `metros` é a distância até o centro.
   */
  async naArea(
    sul: number,
    oeste: number,
    norte: number,
    leste: number,
  ): Promise<ParadaProximaDto[]> {
    if (
      ![sul, oeste, norte, leste].every(Number.isFinite) ||
      Math.abs(sul) > 90 ||
      Math.abs(norte) > 90 ||
      Math.abs(oeste) > 180 ||
      Math.abs(leste) > 180 ||
      sul > norte ||
      oeste > leste
    ) {
      throw new BadRequestException('Área inválida');
    }
    if (norte - sul > LADO_MAXIMO_AREA || leste - oeste > LADO_MAXIMO_AREA) {
      throw new BadRequestException('Área grande demais: aproxime o mapa');
    }

    const rede = await this.obterRede();
    const centro = { lat: (sul + norte) / 2, lng: (oeste + leste) / 2 };
    const resultado: ParadaProximaDto[] = [];
    for (const p of rede.paradas) {
      if (p.lat < sul || p.lat > norte || p.lng < oeste || p.lng > leste)
        continue;
      const linhas = rede.linhas.get(p.codigo);
      if (!linhas) continue;
      resultado.push({
        ...p,
        metros: Math.round(haversine(centro, p)),
        linhas,
      });
    }
    return resultado.sort((a, b) => a.metros - b.metros).slice(0, QUANTAS_AREA);
  }

  private obterRede(): Promise<Rede> {
    const rede = this.rede;
    if (rede && Date.now() - rede.montadaEm < config.paradasTtlMs)
      return Promise.resolve(rede);
    this.emAndamento ??= this.montar()
      .then((nova) => (this.rede = nova))
      .catch((e: unknown) => {
        // Índice vencido é melhor que nenhum.
        if (rede) return rede;
        throw new BadGatewayException(
          `API de transporte indisponível: ${(e as Error).message}`,
        );
      })
      .finally(() => (this.emAndamento = undefined));
    return this.emAndamento;
  }

  private async montar(): Promise<Rede> {
    const inicio = Date.now();
    const paradas = parseParadasCidade(await this.nubus.listarParadas());

    const itinerarios = await this.catalogo.rotas();

    const linhas = new Map<string, LinhaNaParadaDto[]>();
    let falhas = 0;
    await emParalelo(itinerarios, CONCORRENCIA, async (it) => {
      let resposta;
      try {
        resposta = await this.nubus.paradasEspecifica(
          String(it.codigoItinerario),
          false,
        );
      } catch {
        falhas++;
        return;
      }
      const numero = numeroDaLinha(it.descricaolinha ?? '');
      const nome = (it.descricaoItinerario ?? '').trim();
      for (const parada of parseParadas(resposta.paradas)) {
        let lista = linhas.get(parada.codigo);
        if (!lista) linhas.set(parada.codigo, (lista = []));
        let linha = lista.find((l) => l.numero === numero);
        if (!linha) lista.push((linha = { numero, itinerarios: [] }));
        if (nome && !linha.itinerarios.includes(nome))
          linha.itinerarios.push(nome);
      }
    });
    if (itinerarios.length === 0 || falhas === itinerarios.length) {
      throw new Error('nenhum itinerário respondeu');
    }
    for (const lista of linhas.values())
      lista.sort((a, b) =>
        a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }),
      );

    this.logger.log(
      `Índice de paradas: ${paradas.length} paradas, ${itinerarios.length} itinerários` +
        `${falhas ? ` (${falhas} falharam)` : ''}, ${Date.now() - inicio} ms`,
    );
    return { paradas, linhas, montadaEm: Date.now() };
  }
}
