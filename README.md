# Ônibus Natal — rastreamento em tempo real

Aplicação web que mostra os ônibus de Natal/RN se movendo no mapa, a partir
da API pública de transporte (Nubus).

```
API de transporte ──(poll a cada 15s)──> Backend (NestJS) ──> navegadores (Angular + Leaflet)
```

O backend consulta a API **uma vez por linha** a cada 15s, independentemente
de quantas pessoas estejam olhando, e guarda o resultado em memória. Os
navegadores só falam com o backend.

## Estrutura

```
onibus-natal/
├── backend/                       NestJS
│   ├── src/
│   │   ├── main.ts                bootstrap (prefixo /api, CORS)
│   │   ├── app.module.ts
│   │   ├── config.ts              parâmetros (env vars)
│   │   ├── nubus/                 integração com a API externa
│   │   │   ├── nubus.client.ts    HTTP: PesquisaRotas, ListaParadasEspecificaV2
│   │   │   ├── nubus.parse.ts     conversão/limpeza das respostas
│   │   │   └── nubus.types.ts     formato bruto da API
│   │   └── linhas/
│   │       ├── linhas.controller.ts   GET /api/linhas/:numero
│   │       ├── linhas.service.ts      cache, dedup, loop de 15s
│   │       ├── velocidade.ts          média móvel de 90s (Haversine)
│   │       ├── geo.ts                 Haversine
│   │       └── linha.dto.ts           contrato da resposta
│   └── test/app.e2e-spec.ts
└── frontend/                      Angular + Leaflet (ngx-leaflet)
    ├── proxy.conf.json            /api -> http://localhost:3000 em dev
    └── src/app/
        ├── app.ts|html|scss       busca, painel lateral, mapa
        ├── core/
        │   ├── linha.service.ts   polling do backend
        │   └── linha.models.ts    tipos (espelho do DTO)
        └── mapa/
            ├── mapa.ts|scss       componente Leaflet + loop de animação
            └── dead-reckoning/
                ├── rota.ts            traçado em metros, projeção, interpolação
                ├── onibus-animado.ts  dead reckoning + inferência de sentido
                └── frota.ts           sincroniza respostas do backend
```

## Como rodar

Pré-requisito: **Node 24 LTS** (o Angular 22 exige Node ≥ 22.22.3 ou ≥ 24.15).
Com nvm: `nvm use` na raiz do projeto.

Em dois terminais:

```bash
# 1) backend — http://localhost:3000
cd backend
npm install
npm run start:dev
# teste: curl http://localhost:3000/api/linhas/33

# 2) frontend — http://localhost:4200
cd frontend
npm install
npm start
```

Abra http://localhost:4200, digite o número da linha (ou use
`http://localhost:4200/?linha=33`).

Testes: `npm test` nas duas pastas; `npm run test:e2e` no backend.

### Como os projetos foram criados

```bash
npx @nestjs/cli@12 new backend --package-manager npm --skip-git --strict
cd backend && npm install @nestjs/schedule

npx @angular/cli@22 new frontend --style=scss --skip-git --ssr=false --defaults
cd frontend && npm install leaflet @bluehalo/ngx-leaflet && npm install -D @types/leaflet
```

O `@asymmetrik/ngx-leaflet` foi renomeado para `@bluehalo/ngx-leaflet`; a
versão 22 acompanha o Angular 22.

## API do backend

`GET /api/linhas/:numero`: na primeira chamada, consulta a API externa e passa
a acompanhar a linha. Nas seguintes, responde da memória. A linha deixa de ser
acompanhada após 5 min sem acessos.

```jsonc
{
  "numero": "33",
  "atualizadoEm": "2026-10-07T16:33:43.000Z",
  "desatualizado": false,          // true se a última consulta à API falhou
  "itinerarios": [
    {
      "codigo": "101",
      "descricao": "33 - ...",
      "tracado": [[-5.84, -35.21], ...],   // [lat, lng] no sentido de circulação
      "paradas": [{ "codigo": "...", "descricao": "...", "ordem": 1, "lat": -5.8, "lng": -35.2 }]
    }
  ],
  "onibus": [
    {
      "id": "50001",
      "lat": -5.81, "lng": -35.20,
      "velocidadeKmh": 32,
      "itinerarios": ["101", "102"],      // dedup: veículo visto em 2 itinerários
      "posicaoDesde": "2026-10-07T16:33:30.000Z"
    }
  ]
}
```

`GET /api/linhas` lista as linhas acompanhadas no momento.

## Decisões de projeto

**Velocidade (backend).** Para cada veículo guardamos as posições *novas*
(movimentos < 10 m são ruído ou o mesmo GPS repetido). A velocidade é a soma
das distâncias Haversine entre posições consecutivas nos últimos ~90s,
dividida pelo tempo decorrido. Sem posição nova há mais de 60s, o valor é
0 km/h. Saltos acima de 110 km/h reiniciam o histórico, porque são erro de
GPS ou troca de linha.

**Dead reckoning (frontend).** Cada traçado vira uma polilinha em metros, e a
posição do ônibus vira um número `s` (metros desde o início do traçado).
- Entre atualizações: `s = sFix + v · (t − tFix)`, com no máximo 40s de
  extrapolação.
- Quando chega uma posição real, a diferença entre a posição desenhada e a
  real (`erro`) é reduzida exponencialmente (τ = 2,5s). Assim o ônibus
  acelera ou freia até encostar na trajetória real, sem saltos. Em movimento,
  ele nunca anda de ré: se estiver adiantado, espera.
- O sentido (ida/volta) sai de duas posições reais consecutivas: vale o
  itinerário em que `s` aumentou. Na primeira posição, se houver ambiguidade
  (ida e volta na mesma rua), o ônibus fica parado na posição real até a
  próxima leitura.
- O horário da posição é o momento em que o backend a viu mudar
  (`posicaoDesde`), convertido para o relógio do navegador.

**Proteção da API de origem.** As consultas por cliente nunca chegam à API:
requisições simultâneas compartilham a mesma consulta. O backend acompanha
no máximo 40 linhas (configurável), com até 4 em paralelo. A lista de
itinerários é cacheada por 6h.

## Pontos a validar com a API real

O código foi testado com uma API simulada, porque a API real não estava
acessível do ambiente de desenvolvimento. Vale conferir:

- se `PesquisaRotas` com `"33"` também devolve linhas como `"330"` (busca por
  prefixo). Se sim, filtrar em `LinhasService.itinerariosDa` (há um `TODO`);
- se `ListaParadasEspecificaV2` devolve só os carros do itinerário ou todos
  da linha;
- o formato real de `Lat`/`Long` (número ou string). O parser aceita os dois,
  inclusive com vírgula decimal.

## Próximas fases

- **WebSocket**: trocar o polling de 5s do frontend por push (`@nestjs/websockets`
  + socket.io). O `LinhasService` já concentra os snapshots; basta emitir após
  `consolidar()` para a "sala" da linha.
- **PostgreSQL + PostGIS**: gravar as posições (`geography(Point)`) para
  histórico, tempos de viagem e velocidades médias por trecho.
- **Modelagem das paradas**: projetar as paradas no traçado (`s` de cada uma)
  e incluir tempo de parada no dead reckoning, o que reduz o "adiantamento"
  perto dos pontos.
