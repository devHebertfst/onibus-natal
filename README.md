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
acompanhada após 30 min sem acessos e sem conexões SSE.

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
      "paradas": [{ "codigo": "...", "descricao": "...", "ordem": 1, "lat": -5.8, "lng": -35.2 }],
      "trechos": { "tamanhoM": 300, "kmh": [22.5, null, 9.1, ...], "mediaKmh": 17.8 }
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

`GET /api/linhas/catalogo` devolve números e descrições das linhas para a busca
por número, bairro ou destino. Agrupa variantes e remove duplicatas da Nubus,
sem iniciar consultas de GPS. O catálogo compartilha a consulta de rotas com
o índice de paradas e usa o cache de itinerários (6 horas por padrão).

### Previsão da Nubus, paradas próximas e planejamento

- `GET /api/linhas/:numero/previsao?itinerario=<codigo>&parada=<codigo>`:
  previsão de chegada da Nubus, com cache de 15 s e consultas simultâneas
  compartilhadas. Valida se a parada pertence ao itinerário. A placa usa os
  horários da Nubus e a contagem de paradas do mapa; após 90 s sem resposta
  nova, volta à estimativa local. Viagens da tabela aparecem separadas dos
  ônibus com GPS, e horários sem fuso são interpretados como hora de Natal.
- `GET /api/paradas/proximas?lat=-5.8&lng=-35.2`: até 8 paradas em um raio de
  600 m, com as linhas e os sentidos que passam nelas. O parâmetro opcional
  `raio` aceita até 1500 m. O backend monta um índice de paradas e itinerários,
  compartilhado por todos os usuários e atualizado a cada 24 h. O aquecimento
  começa ao iniciar o servidor; a primeira busca pode aguardar sua conclusão.
- `GET /api/trajetos?from_lat=-5.7945&from_lng=-35.211&to_lat=-5.835&to_lng=-35.207&datetime=2026-10-08T08:00`:
  alternativas de viagem com horários, trechos a pé e de ônibus e traçados
  decodificados. `datetime` é opcional e usa a hora de Natal, independente do
  fuso do servidor. Sem ele, planeja a saída agora. Ausência de alternativas
  devolve `viagens: []`; erro da central devolve HTTP 502.

Na tela inicial, **Paradas perto de mim** pede a localização e permite abrir
uma linha já na parada escolhida. **Planejar trajeto** permite escolher os
pontos A e B no mapa (ou usar a localização atual como origem), ajustar a hora
de saída e comparar alternativas. A opção **Usar centro do mapa** permite
escolher os pontos com teclado. No mapa, caminhada é tracejada e ônibus é
linha contínua; A e B identificam origem e destino. Horários do planejador são
da tabela, não posições ao vivo. Se a API retornar só caminhada, a tela avisa;
se faltar geometria, o app não inventa um traçado. A seleção de destinos usa o
mapa, sem busca de endereços nesta versão.

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
- Entre atualizações: `s = sFix + v · (t − tFix)`, com no máximo 60s de
  extrapolação (contados da hora em que o GPS mediu a posição).
- Quando chega uma posição real, a diferença entre a posição desenhada e a
  real (`erro`) é reduzida exponencialmente (τ = 2,5s). Assim o ônibus
  acelera ou freia até encostar na trajetória real, sem saltos. Em movimento,
  ele nunca anda de ré: se estiver adiantado, espera.
- O sentido (ida/volta) sai de duas posições reais consecutivas: vale o
  itinerário em que `s` aumentou. Na primeira posição, se houver ambiguidade
  (ida e volta na mesma rua), o ônibus fica parado na posição real até a
  próxima leitura.
- Velocidade desconhecida (`null`): se o sentido já for conhecido, o ônibus
  anda na velocidade que os ônibus da linha fazem naquele trecho (veja
  "Velocidade por trecho" abaixo) até chegar a velocidade real, com a mesma
  correção suave. Perto das pontas do traçado (250 m, terminais) não estima.
  A lista mostra "calculando…" em vez de "parado".
- O horário da posição (`posicaoDesde`) é a hora em que o GPS a mediu,
  convertida para o relógio do navegador (veja "Hora do GPS" abaixo).

**Hora do GPS (backend).** O traçado da Nubus traz só a posição de cada
ônibus, sem dizer quando o GPS a mediu, e ela chega 10–30s atrasada (GPS →
Nubus → poll de 15s). Extrapolar a partir da hora em que o backend *viu* a
posição deixava o ônibus desenhado atrás do real. A previsão de chegada
(`/previsoes/paradas`) traz `gpsVeiculoData` dos ônibus a caminho da parada:
- quando ela contou a hora de uma posição, o backend usa essa hora real;
- cada correção mede o atraso (visto − GPS), e a mediana das últimas medidas
  é descontada das posições sem hora conhecida (antes de haver medidas, meio
  intervalo de poll);
- a cada 60s o backend pede a previsão no ponto final de cada sentido das
  linhas acompanhadas, para ter horas de GPS mesmo sem ninguém olhando uma
  parada (`AMOSTRA_GPS=false` desliga). Isso não renova o acesso da linha.
"Parado há mais de 60s" continua contado de quando o backend viu a posição.

**Velocidade por trecho (os ônibus como sensores).** Cada itinerário é
dividido em trechos de 300 m, e o backend mede a velocidade de cada um com
os próprios ônibus da linha: duas posições consecutivas de um ônibus dizem
"andou de s0 a s1 em Δt", e o tempo é repartido entre os trechos cobertos.
- Os trechos andam uma posição atrás da atual: quando a posição nova chega,
  a hora real do GPS da anterior quase sempre já chegou (veja "Hora do GPS").
  Com a hora estimada, cada medida errava ±20%; com a real, bate com a
  velocidade do ônibus.
- Δt conta o tempo parado entre as duas posições, então a velocidade já
  inclui pontos, semáforos e engarrafamento: somar o tempo de cada trecho dá
  o tempo de viagem. Por isso a velocidade do trecho é metros ÷ segundos
  somados, não a média das velocidades.
- Observações perdem metade do peso a cada 10 min (o trânsito muda) e um
  trecho sem ônibus há 30 min volta a ser desconhecido. Um trecho só vale
  depois de percorrido ao menos pela metade.
- Descartadas: posição a mais de 60 m do traçado, mais de 5 min ou 2 km
  entre duas posições, acima de 80 km/h, e ônibus "andando para trás" (é o
  sentido contrário, projetado no traçado errado).
- Vai em `itinerarios[].trechos` (km/h por trecho, `null` sem medida, e a
  média do itinerário). O frontend usa na previsão de chegada (tempo trecho
  a trecho até a parada) e no dead reckoning de ônibus de velocidade
  desconhecida. Sem medida, vale a média do itinerário; sem média, 18 km/h.
  As contas limitam a velocidade a 5–60 km/h.

**Medir a precisão.** `GET /api/diagnostico` mostra o atraso medido do GPS
(mediana, p90, quanto está sendo descontado) e, por itinerário, quanto do
traçado já tem velocidade medida (`trechos`: cobertura em % e média). No app, `?debug=1` abre um
painel com o erro do desenho a cada posição nova (metros, segundos e quanto
fica atrás) e a diferença entre a nossa estimativa e a da Nubus.

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

Feita para quem está no ponto, no sol, com uma mão só. O visual segue a
sinalização viária brasileira (CONTRAN): verde de indicação na faixa do topo
e na placa do ponto, amarelo de advertência para dado atrasado, borda vermelha
para erro, letra Overpass (herdeira aberta da letra de rodovia). Tema dia
(chão branco) e noite (chão asfalto, placas continuam acesas), trocando todos
os tokens e o mapa-base. O mapa ocupa a tela inteira; no celular o painel é
uma gaveta arrastável com três alturas.

- **Fluxo do ponto:** abra a linha e escolha o ponto em "Paradas perto de
  mim" (GPS), na lista com busca por rua/bairro ou tocando no mapa (alvo de
  44 px). Paradas de ida e volta no mesmo lugar viram um ponto só.
- **Placa de chegada:** uma linha por sentido, seta no rumo real do traçado,
  tempo até o próximo ônibus, quantas paradas faltam e os seguintes. A
  estimativa (pelo ritmo recente dos ônibus em cada trecho, ou 18 km/h
  enquanto não há medida) é dita como estimativa.
- **Meu ponto:** salvo por linha no navegador; ao reabrir a linha a placa
  aparece direto. Link direto: `?linha=33&parada=<código>`.
- Estado da conexão (ao vivo, reconectando, sem internet, dados atrasados) e
  há quantos segundos chegou o último dado. O leitor de tela só é avisado de
  mudanças (conexão, ponto escolhido, ônibus chegando).
- Linhas favoritas e recentes, guardadas no navegador.
- Atalhos (só com teclado e mouse): `/` busca, `R` linha inteira, `F`
  favorita, `Esc` volta.

O processo de design (brief, contrato de direção, auditoria) está em
`.impeccable/`.

## Próximas fases

- **Busca de destinos por endereço:** complementar a escolha de origem e
  destino no mapa com geocodificação.
- **Service worker** para o app instalado abrir mesmo com internet fraca.
- **PostgreSQL + PostGIS**: gravar as posições (`geography(Point)`) para
  histórico, tempos de viagem e velocidades médias por trecho.
- **Tempo de parada**: as paradas já são projetadas no traçado (`s` de cada
  uma, usado na previsão de chegada); falta incluir o tempo parado no ponto
  no dead reckoning, o que reduz o "adiantamento" perto dos pontos.
