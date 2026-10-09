import { Previsao } from '../mapa/dead-reckoning/previsao';
import { diagnostico } from './diagnostico';
import { Chegada } from './linha.models';

/** Sem resposta nova da Nubus por mais que isso, a placa volta para a estimativa própria. */
export const VALIDADE_OFICIAL_MS = 90_000;
/**
 * Ônibus que já devia ter chegado continua na placa ("chegando") por até
 * 2 min: a próxima resposta da Nubus diz se ele passou ou só atrasou.
 */
const TOLERANCIA_ATRASO_MS = 120_000;

/** Última resposta da Nubus para um sentido do ponto. */
export interface Oficial {
  chegadas: Chegada[];
  /** Relógio do navegador quando a resposta chegou. */
  recebidoEm: number;
}

export interface PrevisoesDoSentido {
  previsoes: Previsao[];
  /** De onde vem o tempo: a previsão da Nubus ou a conta própria (velocidade por trecho). */
  fonte: 'nubus' | 'estimativa';
  /** Próxima viagem da tabela ("20:55"), quando não há ônibus com GPS vindo. */
  tabela: string | null;
}

/**
 * Junta a previsão da Nubus com a estimativa própria. Com a Nubus em dia,
 * ela decide quais ônibus vêm e em quanto tempo (é o número do app oficial);
 * a conta própria entra com o que só ela sabe: quantas paradas faltam. Sem
 * a Nubus (falhou ou está velha), fica a estimativa própria.
 */
export function mesclarPrevisoes(
  local: Previsao[],
  oficial: Oficial | null,
  agora: number,
): PrevisoesDoSentido {
  if (!oficial || agora - oficial.recebidoEm > VALIDADE_OFICIAL_MS) {
    return { previsoes: local, fonte: 'estimativa', tabela: null };
  }

  const previsoes: Previsao[] = [];
  for (const c of oficial.chegadas) {
    if (!c.aoVivo || !c.onibus) continue;
    const chegaEm = Date.parse(c.chegaEm);
    if (!(chegaEm > agora - TOLERANCIA_ATRASO_MS)) continue;
    const meu = local.find((l) => l.onibus === c.onibus);
    const minutos = Math.max(0, (chegaEm - agora) / 60_000);
    if (meu) diagnostico.registrarComparacao(c.onibus, meu.minutos, minutos, agora);
    previsoes.push({
      onibus: c.onibus,
      // A distância própria anda com o ônibus no mapa; a da Nubus é da última consulta.
      metros: meu?.metros ?? c.metros,
      minutos,
      paradas: meu?.paradas ?? null,
    });
  }
  previsoes.sort((a, b) => a.minutos - b.minutos);

  const proximaTabela = previsoes.length
    ? undefined
    : oficial.chegadas.find((c) => !c.aoVivo && Date.parse(c.chegaEm) > agora);
  return {
    previsoes,
    fonte: 'nubus',
    tabela: proximaTabela ? horaLocal(Date.parse(proximaTabela.chegaEm)) : null,
  };
}

/** "20:55", no fuso de Natal (qualquer que seja o do aparelho). */
export function horaLocal(ms: number): string {
  return new Date(ms).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Fortaleza',
  });
}
