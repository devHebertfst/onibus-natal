# Backend (NestJS)

Consulta a API Nubus a cada 15s para as linhas que estão sendo acompanhadas
e expõe os dados consolidados em `GET /api/linhas/:numero`.
Veja o [README principal](../README.md) para a visão geral.

```bash
npm install
npm run start:dev     # http://localhost:3000/api/linhas/33
npm test              # testes unitários
npm run test:e2e      # teste HTTP com a API externa simulada
```

## Variáveis de ambiente

| Variável           | Padrão                                         | Descrição                                   |
| ------------------ | ---------------------------------------------- | ------------------------------------------- |
| `PORT`             | `3000`                                         | Porta HTTP                                  |
| `NUBUS_BASE_URL`   | `https://api-prod-vpc.appnubus.com.br/api/v1`  | API de transporte (útil para apontar p/ fake) |
| `NUBUS_VERSION`    | `2.3.34`                                       | Valor do header `version`                   |
| `NUBUS_CIDADE`     | `ntl`                                          | Cidade                                      |
| `POLL_INTERVAL_MS` | `15000`                                        | Intervalo do loop de atualização            |
| `SSE_PING_MS`      | `20000`                                        | Intervalo do `: ping` no stream SSE         |
| `LINHA_INATIVA_MS` | `300000`                                       | Para de acompanhar linha sem acessos        |
| `MAX_LINHAS`       | `40`                                           | Máximo de linhas acompanhadas               |
| `NUBUS_TIMEOUT_MS` | `10000`                                        | Timeout das consultas externas              |
| `PREVISAO_TTL_MS` | `15000`                                        | Cache da previsão de chegada                |
| `PARADAS_TTL_MS`  | `86400000`                                     | Validade do índice de paradas e linhas       |
| `AQUECER_PARADAS` | `true`                                         | `false` desliga o aquecimento na inicialização |
| `AMOSTRA_GPS_MS`  | `60000`                                        | Intervalo da amostragem da hora do GPS      |
| `AMOSTRA_GPS`     | `true`                                         | `false` desliga a amostragem da hora do GPS |
| `DATABASE_URL`    | (nenhum)                                       | Postgres (Neon): índice de paradas, catálogo de linhas e histórico de velocidade; sem ele, só memória |
| `HISTORICO_GRAVAR_MS` | `300000`                                   | Intervalo da gravação do histórico em lote  |
| `COLETA`          | `true`                                         | `false` desliga o coletor de troncais       |
| `COLETA_LINHAS`   | `auto`                                         | Troncais do coletor: `auto` ou `33,85,...`  |
| `COLETA_QUANTAS`  | `5`                                            | Quantas troncais no modo `auto`             |
| `COLETA_HORAS`    | `6-9,16-19`                                    | Faixas de horário de Natal das rajadas      |
| `COLETA_INTERVALO_MS` | `900000`                                   | Intervalo entre rajadas                     |
| `FERIADOS_EXTRA`  | (nenhum)                                       | Feriados a mais, "MM-DD" ou "AAAA-MM-DD", separados por vírgula |
| `CORS_ORIGIN`      | (qualquer)                                     | Origens permitidas, separadas por vírgula   |

Os endpoints de previsão oficial, paradas próximas e planejamento A→B estão
documentados no [README principal](../README.md#previsão-da-nubus-paradas-próximas-e-planejamento).
