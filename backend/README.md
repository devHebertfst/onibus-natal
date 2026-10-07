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
| `CORS_ORIGIN`      | (qualquer)                                     | Origens permitidas, separadas por vírgula   |
