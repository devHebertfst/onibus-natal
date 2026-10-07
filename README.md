# Ônibus Natal — rastreamento em tempo real

Aplicação web que mostra os ônibus de Natal/RN se movendo no mapa, a partir
da API pública de transporte (Nubus).

```
API de transporte ──(poll a cada 15s)──> Backend (NestJS) ──(SSE, push)──> navegadores (Angular + Leaflet)
```

O backend consulta a API **uma vez por linha** a cada 15s, independentemente
de quantas pessoas estejam olhando, e guarda o resultado em memória. Os
navegadores só falam com o backend, que **empurra** cada atualização por
Server-Sent Events assim que ela sai, sem o navegador precisar perguntar.

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
│   │       ├── linhas.service.ts      cache, dedup, loop de 15s, observar()
│   │       ├── velocidade.ts          média móvel de 90s (Haversine)
│   │       ├── geo.ts                 Haversine
│   │       └── linha.dto.ts           contrato da resposta
│   └── test/app.e2e-spec.ts
└── frontend/                      Angular + Leaflet (ngx-leaflet)
    ├── proxy.conf.json            /api -> http://localhost:3000 em dev
    └── src/app/
        ├── app.ts|html|scss       busca, painel lateral, mapa
        ├── core/
        │   ├── linha.service.ts   EventSource (SSE) do backend
        │   ├── favoritas.service.ts  favoritas/recentes (localStorage)
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

`GET /api/linhas/:numero/stream` é a versão em tempo real (Server-Sent
Events): envia o snapshot atual e depois cada atualização como `event: linha`
(mesmo JSON acima). Um erro vira `event: erro` com `{ status, message }` e
encerra o fluxo; o `EventSource` reconecta sozinho, e o frontend só fecha a
conexão em erros definitivos (400/404). A cada 20s vai um comentário `: ping`
para proxies não derrubarem a conexão. Enquanto houver alguém conectado, a
linha continua sendo acompanhada.

```bash
curl -N http://localhost:3000/api/linhas/33/stream
```

`GET /api/linhas` lista as linhas acompanhadas no momento.

## Decisões de projeto

**Velocidade (backend).** Para cada veículo guardamos as posições *novas*
(movimentos < 10 m são ruído ou o mesmo GPS repetido). A velocidade é a soma
das distâncias Haversine entre posições consecutivas nos últimos ~90s,
dividida pelo tempo decorrido. Sem posição nova há mais de 60s, o valor é
0 km/h. Enquanto houver uma só posição (linha recém-acompanhada; o GPS da
Nubus muda a cada ~30s), a velocidade vai como `null` ("desconhecida"), e
não 0. Saltos acima de 110 km/h reiniciam o histórico, porque são erro de
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
- Velocidade desconhecida (`null`): se o sentido já for conhecido, o ônibus
  anda a 18 km/h (média urbana) até chegar a velocidade real, com a mesma
  correção suave. Perto das pontas do traçado (250 m, terminais) não estima.
  A lista mostra "calculando…" em vez de "parado".
- O horário da posição é o momento em que o backend a viu mudar
  (`posicaoDesde`), convertido para o relógio do navegador.

**Proteção da API de origem.** As consultas por cliente nunca chegam à API:
requisições simultâneas compartilham a mesma consulta. O backend acompanha
no máximo 40 linhas (configurável), com até 4 em paralelo. Com o limite
atingido, a linha sem conexões há mais tempo sem acesso dá lugar à nova. A
lista de itinerários é cacheada por 6h.

**Linhas "aquecidas".** Uma linha continua sendo acompanhada por 30 min
depois do último acesso, para quem abri-la em seguida já receber velocidade
e sentido prontos. Sem ninguém olhando, ela é atualizada a cada ~30s (o
ritmo do GPS) em vez de 15s. "098" e "98" são a mesma entrada.

## Formato real da API (conferido)

- `PesquisaRotas` busca por trecho: `"33"` traz 33, 33 Extra, 33A, 33B e 133.
  `filtrarPorLinha` mantém só os itinerários cujo `descricaolinha` (`"O-33"`,
  `"O-33 Extra"`) bate com o número pedido. A API também repete itens, que
  são descartados.
- `ListaParadasEspecificaV2` devolve uma **lista** com um item
  (`[{ itinerario, paradas, pontos, carros }]`), não um objeto.
- `Lat`/`Long` das paradas vêm como string, e as dos carros como número.

## Interface

O visual segue a linha de painel de telemetria do
[Ponto.OS](https://pontoos.com.br/) (Cuiabá): tema escuro com acento
vermelho, mapa em tela cheia e o painel flutuando por cima (no celular ele
vira uma gaveta embaixo).
- Status da conexão (ao vivo / reconectando / atrasado) e há quantos segundos
  chegou o último dado.
- Linhas favoritas e recentes, guardadas no navegador.
- Toque numa parada para ver os próximos ônibus com estimativa de chegada:
  distância pelo traçado até a parada (paradas projetadas no traçado, em
  ordem) dividida pela velocidade comercial de 18 km/h.
- Mapa escuro ou claro (Esri Dark/Light Gray, sem chave de API), botão
  "centralizar em mim", tela de abertura e manifest para instalar como app.
- Atalhos: `/` busca, `R` enquadra a rota, `F` favorita, `Esc` fecha.

## Próximas fases

- **Busca por parada e planejador de rota** (a pé + ônibus), como no Ponto.OS.
- **Service worker** para o app instalado abrir mesmo com internet fraca.
- **PostgreSQL + PostGIS**: gravar as posições (`geography(Point)`) para
  histórico, tempos de viagem e velocidades médias por trecho.
- **Tempo de parada**: as paradas já são projetadas no traçado (`s` de cada
  uma, usado na previsão de chegada); falta incluir o tempo parado no ponto
  no dead reckoning, o que reduz o "adiantamento" perto dos pontos.
