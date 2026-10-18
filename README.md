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
acompanhada após 5 min sem acessos e sem conexões SSE.

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
  compartilhado por todos os usuários e atualizado a cada 24 h. Com banco
  (`DATABASE_URL`), o índice fica guardado e o servidor que acorda lê de lá
  (veja "Guardado no banco"); sem banco, o aquecimento começa ao iniciar o
  servidor e a primeira busca pode aguardar sua conclusão.
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
- Perto das paradas o desenho freia: a partir de 60 m antes, reduz até 30%
  da velocidade de cruzeiro e retoma nos 30 m seguintes. O cruzeiro é
  ajustado para que, ao fim dos 60 s de extrapolação, o ônibus esteja no
  mesmo lugar que estaria em velocidade constante (a média não muda, só o
  formato do movimento). Como nem todo ônibus para em todo ponto, é freada e
  não parada; e errar para trás é melhor que para frente: atrás, o desenho
  só acelera um pouco para alcançar; à frente, teria de esperar parado.
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
  desconhecida. Sem medida, vale o histórico (abaixo); sem ele, a média do
  itinerário; sem média, 18 km/h. As contas limitam a velocidade a 5–60 km/h.

**Guardado no banco (Postgres/Neon).** Montar o índice de paradas custa ~130
consultas à API e o catálogo de linhas, 10. Com `DATABASE_URL`, os dois ficam
guardados (JSON compactado na tabela `cache_persistente`): o servidor que
acorda (o Render free dorme após ~15 min) lê de lá em vez de refazer as
consultas. Vencidos (24 h o índice, 6 h o catálogo), continuam sendo servidos
enquanto a versão nova é montada em segundo plano, então ninguém espera a
remontagem; se a API falhar, segue com o anterior e tenta de novo em 5 min.

**Histórico por horário (Postgres/Neon).** Com `DATABASE_URL`, o backend
guarda quanto os ônibus levam em cada trecho por tipo de dia (útil, sábado,
domingo) e faixa de 30 min, no horário de Natal. Feriados (nacionais, do RN
e de Natal, com Carnaval, Sexta-feira Santa e Corpus Christi calculados pela
Páscoa) contam como domingo; datas a mais vão em `FERIADOS_EXTRA`. Assim, uma linha recém-
aberta (ou o servidor recém-acordado) já começa com o ritmo típico daquele
horário em vez de 18 km/h, e as medidas ao vivo vão tomando o lugar.
- Grava em lote a cada 5 min (`HISTORICO_GRAVAR_MS`) e ao desligar; lê o
  histórico de cada itinerário uma vez (a 1ª atualização da linha espera
  até 2 s por ele) e relê a cada 6 h. A faixa atual vale inteira e as
  vizinhas com meio peso.
- Medidas antigas perdem metade do peso a cada 14 dias. Se o traçado do
  itinerário mudar, o histórico dele recomeça.
- Tabela `velocidade_trecho`, criada sozinha na 1ª conexão.
- Sem `DATABASE_URL`, ou com o banco fora do ar, tudo funciona só com as
  medidas ao vivo; `/api/diagnostico` mostra em `historico` se está gravando
  e a última falha.

Para ligar no Neon: crie um projeto em neon.tech (região perto do backend),
copie a *connection string* (`postgresql://…?sslmode=require`) e coloque em
`DATABASE_URL` nas variáveis de ambiente do Render. No plano free o Render
dorme após ~15 min sem acessos, e dormindo ninguém coleta posições; um ping
externo (UptimeRobot, cron-job.org) em `/api/saude` a cada 10 min o mantém
acordado. Essa rota só responde `ok` (2 bytes): o cron-job.org aborta
respostas grandes e desativa o job depois de várias falhas.

**Trânsito compartilhado entre linhas.** Linhas diferentes param em pontos
diferentes, então a velocidade de uma não serve direto para outra. O que se
compartilha é a razão "velocidade agora ÷ típica daquele trecho e horário"
(do histórico), por pedaço de rua de ~150 m e por sentido (8 rumos). Se a 85
está 40% mais lenta que o normal na Salgado Filho, a previsão da 33 ali
também fica 40% mais lenta. Na velocidade de cada trecho vale, nesta ordem:
a medida da própria linha, o típico ajustado pelo que as outras mediram nas
mesmas ruas, o típico, a média. Não faz nenhuma consulta a mais: usa o que
as linhas abertas (e o coletor) já leem. Precisa do histórico (banco).

**Coletor por amostras.** Para o histórico e o trânsito crescerem mesmo com
pouco uso, o coletor lê algumas linhas troncais em rajadas: a cada 15 min,
nos horários de `COLETA_HORAS` (padrão `6-9,16-19`, pico), duas leituras com
1 min entre elas, e para. Cada rajada custa 2 consultas por sentido de cada
linha; com 10 troncais e o padrão, ~1.000 consultas por dia (mais um pouco
nas linhas com 3 sentidos). Essas linhas ficam fora do ciclo de 15 s e da
amostragem de GPS; se alguém abrir uma delas, ela entra no ciclo normal.
`COLETA_LINHAS=auto` (padrão) escolhe as 10 (`COLETA_QUANTAS`) que, juntas,
mais cobrem ruas por onde passam outras linhas, a partir do índice de
paradas; ou liste os números (`33,85`). No automático, uma troncal que
passa 3 rajadas seguidas sem nenhum ônibus com GPS (linha sem GPS na Nubus,
ou sem ônibus rodando naquele horário, como uma expressa fora do pico) é
trocada pela próxima melhor e fica fora da escolha por 7 dias
(`COLETA_DESCARTE_DIAS`, guardado no banco), para não gastar de novo o
começo de cada pico; depois volta a ser testada. Ônibus parados (no
terminal, por exemplo) não contam: a linha tem GPS, só não andou. Linhas listadas à
mão nunca são trocadas. `COLETA=false` desliga. `/api/diagnostico` mostra
em `coleta` as linhas, as trocadas (`descartadas`) e as rajadas, e em
`transito` quantos pedaços de rua têm medida.

**Medir a precisão.** O backend mantém um placar da previsão de chegada
contra a chegada real, para a nossa estimativa e para a da Nubus:
- a cada atualização das linhas acompanhadas (e do coletor), calcula a
  previsão que o app mostraria para as paradas à frente de cada ônibus e
  guarda a feita a 2, 5, 10 e 15 min da chegada;
- a previsão da Nubus entra quando alguém (ou a amostragem de GPS) consulta
  uma parada;
- quando o ônibus passa pela parada (interpolando entre as duas posições ao
  redor dela), o erro de cada previsão vai para o placar.

`GET /api/diagnostico` mostra em `placar`, por antecedência: quantas
chegadas, erro médio, mediana, p90 e viés em minutos (viés > 0: previu mais
tarde do que o ônibus chegou), e em `comparacao` a % de vezes em que a nossa
errou menos que a da Nubus na mesma chegada. O placar perde metade do peso a
cada 7 dias (mostra o desempenho atual) e fica guardado no banco.

**Correção do viés.** Se a nossa conta erra sempre para o mesmo lado, o
placar transforma esse viés numa correção, sempre pelo viés **mediano** (a
média se deixa levar pelos poucos ônibus que atrasam muito, e corrigir por
ela piora as previsões que já acertavam):
- geral, por horizonte com 30 chegadas ou mais, limitada a 25% do horizonte
  e interpolada entre os horizontes;
- por linha, com 50 chegadas ou mais: uma fração da previsão (a 105 chega
  50% depois do previsto → soma 50%), limitada entre dobrar e tirar um
  terço, que vale no lugar da geral.

Ela vai na resposta de cada linha (`ajustePrevisao`) e o app a aplica. A
correção sai sempre da conta crua (`nossa`); a corrigida aparece em
`ajustada`, para ver se ela ajuda. `ajuste` mostra a correção geral em uso;
`viesMedianoMin` (por horizonte) e, em `porLinha`, `viesMedianoPct` e
`correcaoPct` mostram de onde ela sai.

**Onde a previsão erra.** `porDado` separa a conta crua pela origem da maior
parte da velocidade usada até a parada: `aoVivo` (medida agora pelos ônibus
da linha), `historico` (típica do horário, ajustada pelo trânsito),
`mediaLinha` (média da linha nos trechos sem dado) e `padrao` (18 km/h).
`porLinha` dá o erro médio e o viés de cada linha em % da antecedência
(juntando os horizontes). Cada trecho de `trechos` traz em `fontes` a origem
da velocidade dele (`v`, `h`, `t` ou `-`).

O diagnóstico também mostra o atraso medido do GPS (mediana, p90, quanto
está sendo descontado), por itinerário quanto do traçado já tem velocidade
medida (`trechos`) e o estado do histórico no banco (`historico`). No app,
`?debug=1` abre um painel com o erro do desenho a cada posição nova e a
diferença entre a nossa estimativa e a da Nubus.

**Proteção da API de origem.** As consultas por cliente nunca chegam à API:
requisições simultâneas compartilham a mesma consulta. O backend acompanha
no máximo 40 linhas (configurável), com até 4 em paralelo. Com o limite
atingido, a linha sem conexões há mais tempo sem acesso dá lugar à nova. A
lista de itinerários é cacheada por 6h.

**Linhas "aquecidas".** Uma linha continua sendo acompanhada por 5 min
depois do último acesso, para quem fecha o app e volta logo já receber
velocidade e sentido prontos. Sem ninguém olhando, ela é atualizada a cada
~30s (o ritmo do GPS) em vez de 15s. Era 30 min; caiu para 5 porque esse
"rabo" custava ~75% das consultas de cada visita e o ritmo dos trechos já
fica guardado no banco. "098" e "98" são a mesma entrada.

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
