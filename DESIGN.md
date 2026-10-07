---
name: Ônibus Natal
description: Os ônibus de Natal no mapa em tempo real, com a chegada no seu ponto lida numa placa de indicação.
colors:
  placa: "#00653a"
  placa-escura: "#004d2c"
  placa-texto: "#ffffff"
  placa-texto-2: "#e2efe7"
  adv: "#ffc20e"
  adv-texto: "#1b1f22"
  reg: "#c4161c"
  reg-fundo: "#fdecec"
  chao: "#ffffff"
  chao-2: "#eef1f2"
  chao-3: "#e1e6e8"
  linha: "#cdd4d8"
  linha-forte: "#7d878d"
  texto: "#1b1f22"
  texto-2: "#3a4146"
  texto-3: "#535c62"
  foco: "#1b1f22"
  selecao: "#ffc20e"
  chao-noite: "#111416"
  chao-2-noite: "#1b1f22"
  chao-3-noite: "#262c30"
  linha-noite: "#333b40"
  linha-forte-noite: "#6e7981"
  texto-noite: "#f1f3f4"
  texto-2-noite: "#cfd5d8"
  texto-3-noite: "#a5aeb3"
  placa-escura-noite: "#00512f"
  reg-noite: "#ff6b6b"
  reg-fundo-noite: "#3a1a1b"
  foco-noite: "#ffffff"
  sentido-azul: "#1859c2"
  sentido-laranja: "#d9590b"
  sentido-verde: "#0f7a43"
  sentido-roxo: "#9c2f86"
  sentido-petroleo: "#0b7f8c"
  sentido-terra: "#7a5418"
  sentido-azul-noite: "#6b9cf2"
  sentido-laranja-noite: "#f0813a"
  sentido-verde-noite: "#3fb57a"
  sentido-roxo-noite: "#c86bb6"
  sentido-petroleo-noite: "#3cb6c2"
  sentido-terra-noite: "#c79a4e"
  sem-rota: "#6b7378"
typography:
  display:
    fontFamily: "'Overpass Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "40px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.03em"
    fontFeature: "tnum"
  headline:
    fontFamily: "'Overpass Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "20px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  campo:
    fontFamily: "'Overpass Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "22px"
    fontWeight: 800
    fontFeature: "tnum"
  title:
    fontFamily: "'Overpass Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "'Overpass Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "'Overpass Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.35
    fontFeature: "tnum"
  label-mapa:
    fontFamily: "'Overpass Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1
    fontFeature: "tnum"
rounded:
  plaquinha: "4px"
  raio: "8px"
  raio-painel: "14px"
  gaveta: "18px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  painel: "14px"
  lg: "16px"
components:
  placa-chegada:
    backgroundColor: "{colors.placa}"
    textColor: "{colors.placa-texto}"
    rounded: "{rounded.raio}"
    padding: "14px 16px 10px"
  topo:
    backgroundColor: "{colors.placa}"
    textColor: "{colors.placa-texto}"
    typography: "{typography.headline}"
    height: "56px"
    padding: "0 16px"
  campo-linha:
    backgroundColor: "{colors.chao}"
    textColor: "{colors.texto}"
    typography: "{typography.campo}"
    rounded: "{rounded.raio}"
    height: "52px"
  campo-linha-rotulo:
    backgroundColor: "{colors.placa}"
    textColor: "{colors.placa-texto}"
    padding: "0 10px"
  botao-ver:
    backgroundColor: "{colors.texto}"
    textColor: "{colors.chao}"
    padding: "0 16px"
  botao:
    backgroundColor: "{colors.chao}"
    textColor: "{colors.texto}"
    rounded: "{rounded.raio}"
    padding: "0 14px"
    height: "48px"
  botao-hover:
    backgroundColor: "{colors.chao-2}"
  botao-principal:
    backgroundColor: "{colors.placa}"
    textColor: "{colors.placa-texto}"
    rounded: "{rounded.raio}"
    padding: "0 14px"
    height: "48px"
    width: "100%"
  botao-principal-hover:
    backgroundColor: "{colors.placa-escura}"
  botao-secundario:
    backgroundColor: "{colors.chao}"
    textColor: "{colors.texto}"
    rounded: "{rounded.raio}"
    padding: "0 14px"
    height: "48px"
  estrela:
    backgroundColor: "{colors.chao}"
    textColor: "{colors.texto-2}"
    rounded: "{rounded.raio}"
    size: "52px"
  estrela-ativa:
    backgroundColor: "{colors.adv}"
    textColor: "{colors.adv-texto}"
  chip-linha:
    backgroundColor: "{colors.chao}"
    textColor: "{colors.texto}"
    rounded: "{rounded.raio}"
    padding: "0 14px"
    height: "48px"
  controle-mapa:
    backgroundColor: "{colors.chao}"
    textColor: "{colors.texto}"
    rounded: "{rounded.raio}"
    size: "44px"
  controle-mapa-ativo:
    backgroundColor: "{colors.placa}"
    textColor: "{colors.placa-texto}"
  item-lista:
    textColor: "{colors.texto}"
    padding: "10px 4px"
    height: "56px"
  item-frota-selecionado:
    backgroundColor: "{colors.texto}"
    textColor: "{colors.chao}"
    rounded: "{rounded.plaquinha}"
    padding: "8px 10px"
  aviso-erro:
    backgroundColor: "{colors.reg-fundo}"
    textColor: "{colors.texto}"
    rounded: "{rounded.raio}"
    padding: "10px 12px"
  aviso-adv:
    backgroundColor: "{colors.adv}"
    textColor: "{colors.adv-texto}"
    rounded: "{rounded.raio}"
    padding: "10px 12px"
  status-alerta:
    backgroundColor: "{colors.adv}"
    textColor: "{colors.adv-texto}"
    rounded: "{rounded.plaquinha}"
    padding: "4px 8px"
  toast:
    backgroundColor: "{colors.texto}"
    textColor: "{colors.chao}"
    rounded: "{rounded.raio}"
    padding: "12px 16px"
  painel:
    backgroundColor: "{colors.chao}"
    textColor: "{colors.texto}"
    rounded: "{rounded.raio-painel}"
    padding: "14px 16px 12px"
    width: "400px"
---

# Design System: Ônibus Natal

## Overview

**Creative North Star: "A Placa de Indicação"**

O Ônibus Natal fala a língua das placas que o passageiro já lê na rua: a sinalização viária brasileira do CONTRAN. A informação principal (quanto falta para o ônibus chegar no seu ponto) mora numa placa de indicação de verdade: fundo verde, filete branco interno, seta apontando o rumo, destino em letra de rodovia e o tempo em algarismos grandes. Tudo o que não é placa é chão: branco e asfalto de dia, asfalto escuro à noite. O mapa ocupa a tela inteira e as placas ficam por cima dele, como sinalização sobre a cidade.

Cada cor tem o papel que tem na rua e só esse. Verde de indicação é informação e caminho (o topo, a placa do ponto, a ação principal, o rótulo do campo). Amarelo de advertência, sempre com preto, avisa que o dado está atrasado, que a conexão está voltando ou que a localização falhou. Vermelho de regulamentação marca erro, como o anel e a borda de uma placa de proibição. As cores dos sentidos (azul de serviço, laranja de obras e mais quatro) pintam o traçado no mapa e voltam como quadradinhos nas listas e na placa, para o passageiro ligar o que lê ao que vê. À noite o chão escurece e as placas continuam acesas no mesmo verde, como placas refletivas sob o farol.

A densidade é de rua: letras pesadas, alvos de toque de 44 a 56 px, contraste para sol forte e uma mão só. O sistema recusa os dois padrões da categoria: o painel de telemetria escuro com neon e brilhos, e a pilha de cartões brancos genéricos com um azul de destaque.

**Key Characteristics:**
- Placa de indicação verde (#00653a) com filete branco inset como peça central; o verde não muda entre dia e noite.
- Overpass Variable em pesos altos (700–800), sempre com algarismos tabulares nos números que mudam.
- Chão neutro (branco/asfalto) e mapa-base cinza sem cor própria; a cor vem das placas e dos sentidos.
- Forma indica categoria: retângulo verde é indicação, losango amarelo é advertência, anel vermelho é regulamentação.
- Listas separadas por régua fina, não por cartões; profundidade só para o que flutua sobre o mapa.
- Movimento curto e com uma só curva (cubic-bezier(0.22, 1, 0.36, 1)); o único movimento da placa é o minuto novo subindo.

## Colors

Paleta de sinalização: um verde institucional dominante, dois sinais de alerta com papel fixo, chão neutro e seis cores de sentido para o mapa.

### Primary
- **Verde Indicação** (placa): casca do produto. Topo, placa de chegada, botão principal, controle de mapa ativo, rótulo "Linha" do campo de busca, parada ativa no mapa, cor da barra do sistema (`theme-color`) e do ícone. Texto sobre ele é sempre branco (placa-texto), com contraste de cerca de 7:1.
- **Verde Indicação Fundo** (placa-escura): hover do botão principal e contorno do escudo de rodovia no topo. À noite fica um pouco mais claro (placa-escura-noite).
- **Branco de Placa** (placa-texto) e **Branco Gelo de Placa** (placa-texto-2): letra e filete sobre o verde; o segundo, para detalhes secundários dentro da placa e para a idade do dado no topo.

### Secondary
- **Amarelo Advertência** (adv) com **Preto de Placa** (adv-texto): estado "atrasado"/"reconectando" no topo, aviso de localização, nota de dado velho do servidor, favorita ativa e seleção de texto (selecao). Nunca aparece sem o preto por cima.

### Tertiary
- **Vermelho Regulamentação** (reg) sobre **Rosa de Erro** (reg-fundo): só para erro, como borda de 2px e anel de 12px na frente da mensagem. À noite vira um vermelho mais claro (reg-noite) sobre fundo vinho (reg-fundo-noite) para manter o contraste.

### Sentidos (cores de dados)
- **Azul Serviço, Laranja Obras, Verde Rota, Roxo, Petróleo, Terra** (sentido-*): atribuídos em ordem aos itinerários de uma linha. Pintam o traçado (4px sobre contorno de 8px na cor do chão), o corpo do marcador de ônibus e os quadradinhos de sentido nas listas e na placa. Cada uma tem uma versão mais clara para a noite (sentido-*-noite), porque o azul do dia some no mapa escuro.
- **Cinza Sem Rota** (sem-rota): ônibus cujo sentido ainda não é conhecido.

### Neutral
- **Chão** (chao / chao-noite): fundo do painel, dos controles e do corpo da página. Branco de dia, asfalto quase preto à noite.
- **Chão 2 e Chão 3** (chao-2, chao-3 e versões noite): hover de botões e itens, fundo do mapa antes dos tiles, botão "Todas as paradas".
- **Régua** (linha): divisória de 1px entre itens de lista.
- **Contorno Forte** (linha-forte): borda de 2px dos controles secundários (estrela, botão secundário, filtro, chip de recente), alça da gaveta, barra de rolagem. Escurecido/clareado para passar de 3:1.
- **Asfalto** (texto), **Asfalto 2** (texto-2), **Asfalto 3** (texto-3): texto principal, de apoio e de nota/dica. À noite se invertem para tons claros (texto-noite etc.).
- **Foco** (foco): anel de 3px com 2px de afastamento; asfalto de dia, branco à noite.

O mapa-base é emprestado: tiles Esri Light Gray (dia) e Dark Gray (noite), sem chave de API. Ele é cinza e neutro o suficiente para não competir com as placas, mas não foi desenhado para este mundo.

### Named Rules
**A Regra da Placa Acesa.** O verde de indicação é o mesmo nos dois temas. À noite muda o chão, nunca a placa.

**A Regra do Amarelo com Preto.** Amarelo de advertência sempre leva texto ou ícone preto (adv-texto) por cima, nos dois temas.

**A Regra do Vermelho em Filete.** Vermelho de regulamentação aparece como borda e anel, nunca como campo cheio; o fundo do erro é o tom pálido (reg-fundo).

**A Regra da Cor de Sentido.** Uma cor de sentido só existe porque está no traçado do mapa; ela reaparece igual (do mesmo tema) em toda lista, placa e marcador que se refere àquele sentido.

## Typography

**Display Font:** Overpass Variable (com ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif)
**Body Font:** Overpass Variable (mesma pilha)

**Character:** Uma só família, a herdeira aberta da letra de rodovia, carregando a hierarquia pelo peso: 800 para o que se lê de longe, 700 para rótulos e itens, 400–600 para texto de apoio. Caixa mista em tudo, como nos destinos das placas brasileiras.

### Hierarchy
- **Display** (800, 40px, 1, -0.03em, tabular): o número de minutos na placa de chegada. Único tamanho grande do sistema.
- **Campo** (800, 22px, tabular): o número da linha digitado no campo de busca.
- **Headline** (800, 20px, 1.15, -0.01em): destino na placa, título "Em qual ponto você está?", marca no topo (18px no celular), números dos chips de linha e velocidade na frota.
- **Title** (700–800, 16px, 1.25): nome da parada nas listas, títulos de seção ("Ônibus agora", "Favoritas"), botão principal, número da linha no escudo.
- **Body** (400, 15px, 1.4–1.45): avisos, dicas, resumo da linha, botões (700), toast (600). Tamanho-base da página: 16px.
- **Label** (700, 14px, 1.35, tabular): estado da conexão e idade do dado no topo, sentidos nas listas, detalhe da placa (peso normal, placa-texto-2), nota de estimativa. Rodapé e número do ônibus a 13px.
- **Label do mapa** (700, 13px, 1, tabular): rótulo ao lado do marcador de ônibus seguido ou selecionado.

### Named Rules
**A Regra dos Algarismos Tabulares.** Todo número que muda na tela (minutos, velocidade, idade do dado, distância, número da linha e do ônibus) usa `font-variant-numeric: tabular-nums`, para não tremer a cada atualização.

**A Regra do Peso de Placa.** A hierarquia se faz com peso e tamanho dentro de uma família só; não se introduz segunda família nem caixa-alta.

## Layout

Mapa em tela cheia (`position: fixed; inset: 0`), com topo, controles e painel flutuando por cima. A página não rola: `overflow: clip` no `html`, `body` e no componente raiz; só o conteúdo do painel rola.

- **Desktop (acima de 760px):** coluna esquerda de 400px a 12px das bordas (respeitando `safe-area-inset`). Topo verde de 56px com cantos superiores de 14px, emendado ao painel branco logo abaixo (cantos inferiores de 14px). Controles do mapa empilhados no canto superior direito, com 8px entre eles. Ordem do painel: busca, placa (ou "Em qual ponto você está?"), linha e frota, rodapé com atalhos de teclado (só com `hover: hover` e `pointer: fine`).
- **Celular (até 760px):** topo verde de 52px colado no alto, de ponta a ponta, somando `safe-area-inset-top`. O painel vira gaveta inferior com três alturas (baixa ≈40dvh, média 64dvh, alta quase a tela toda); ela tem sempre a altura máxima e desliza com `transform`. Os controles do mapa, a atribuição e o toast sobem junto com a gaveta (variável `--altura-gaveta`), ficando ao alcance do polegar logo acima dela. O zoom vira pinça (botões de zoom escondidos).
- **Ritmo:** passos de 4, 6, 8, 10, 12, 14 e 16px. Margem de 12px até a borda da tela; 14px entre blocos do painel e no padding da gaveta; 16px de padding lateral no topo e no painel desktop.
- **Alvos de toque:** 44px (controles do mapa, limpar campo, botões de zoom), 48px (botões, chips, filtro, expandir), 52px (campo de linha e estrela), 56px (itens das listas de paradas e frota).

## Elevation & Depth

Sistema plano no chão e com sombra só no que flutua sobre o mapa. Dentro do painel não há sombra: a separação é por régua e por inversão de cor. Sem brilhos, sem halos coloridos, sem desfoque de fundo.

### Shadow Vocabulary
- **Sombra** (`--sombra`; dia `0 1px 2px rgb(16 20 22 / 16%), 0 6px 18px rgb(16 20 22 / 14%)`, noite `0 1px 2px rgb(0 0 0 / 40%), 0 8px 22px rgb(0 0 0 / 45%)`): painel desktop, controles do mapa, botões de zoom, toast.
- **Sombra de Placa** (`--sombra-placa`; dia `0 2px 4px rgb(16 20 22 / 22%), 0 8px 20px rgb(16 20 22 / 16%)`, noite `0 2px 4px rgb(0 0 0 / 45%), 0 8px 22px rgb(0 0 0 / 40%)`): só a placa de chegada, que fica um degrau acima do painel.
- **Sombra da Gaveta** (`0 -2px 12px rgb(16 20 22 / 18%)`): gaveta no celular, projetada para cima.
- **Sombra de Marcador** (`0 1px 4px rgb(0 0 0 / 35%)`; selecionado `0 0 0 3px var(--texto), 0 2px 6px rgb(0 0 0 / 35%)`): marcadores de ônibus e de parada ativa no mapa. O anel de asfalto de 3px é a marca de seleção no mapa.

### Named Rules
**A Regra de Só Flutua o que Está Sobre o Mapa.** Sombra é para elementos por cima do mapa e para a placa; listas, avisos e botões dentro do painel ficam planos.

## Shapes

Cantos de placa: 8px (`--raio`) em placas, botões, campos, avisos, controles e toast; 14px (`--raio-painel`) no conjunto topo + painel no desktop; 18px nos cantos superiores da gaveta no celular; 4px nas plaquinhas pequenas (estado de alerta no topo, nota amarela, item de frota selecionado, rótulo do ônibus no mapa, tecla `kbd`).

Silhuetas com significado, tiradas das placas:
- **Filete branco inset:** borda de 2px a 4px da borda externa, com raio de 5px (`raio - 3px`). Na placa de chegada, na parada ativa do mapa e no ícone do app.
- **Escudo de rodovia:** escudo branco com contorno verde-escuro e o número da linha em preto, no topo.
- **Losango:** a luz de estado vira losango de 8px girado 45° quando o estado é de advertência; círculo de 9px nos outros.
- **Anel:** círculo de 12px com borda vermelha de 3px antes da mensagem de erro.
- **Quadradinho de sentido:** 10–14px com cantos de 2–3px, na cor do sentido; na placa ganha filete branco de 2px.
- **Ponto de parada:** círculo de 14px com borda de asfalto de 3px sobre o chão; ativo, vira mini placa verde de 26px com filete branco.
- **Marcador de ônibus:** quadrado de 28px, cantos de 7px, borda branca de 2px, na cor do sentido, com seta branca no rumo (ou ponto branco enquanto o rumo é desconhecido).

Bordas de controles são grossas (2px) e retas; ícones são traços de 2px com pontas redondas, desenhados em SVG inline a 20px.

## Components

### Placa de chegada (assinatura)
A peça que define o produto: uma placa de indicação com o ponto do passageiro e, para cada sentido, quanto falta.
- **Forma:** fundo verde, cantos de 8px, filete branco interno, Sombra de Placa, padding 14px 16px 10px.
- **Cabeçalho:** nome da parada a 15px/700, com o pino branco quando é "meu ponto". À direita, o botão "Trocar" (44px, filete branco de 2px sobre o verde, cantos de 4px), que volta à escolha do ponto.
- **Linhas:** grade de três colunas (seta de 34px, destino, tempo), separadas por régua branca de 2px a 55% de opacidade. A seta gira para o rumo real do sentido (transição de 0,4s); sem rumo, fica a 60%. Sob a seta, a letra do rumo (N, NE, L, SE, S, SO, O, NO) a 13px/800, como numa rosa dos ventos; o leitor de tela ouve "indo para o sudeste".
- **Destino:** quadradinho do sentido com filete branco + nome a 20px/800; abaixo, detalhes a 14px em placa-texto-2, um por linha: "a 3 paradas daqui (1,2 km)", "ônibus nº CDN70025" (o ônibus que a placa está seguindo) e "depois: 8 e 18 min".
- **Ônibus seguido:** a placa segue um ônibus por sentido. Se ele some da conta (passou do ponto, mudou de sentido, perdeu o GPS), o número muda e uma plaquinha amarela com preto diz por quê ("O ônibus nº X já passou por aqui.") durante 45 s; nunca troca o número em silêncio.
- **Tempo:** minutos a 40px/800 + "min" a 16px/700. Quando o ônibus está chegando, vira uma plaquinha invertida (branca, letra verde, cantos de 4px) com "chegando". Sem ônibus vindo, um travessão a 28px e 70%.
- **Movimento:** o minuto novo sobe no lugar do antigo (animação `troca`, 0,45s, deslocamento de 40% com recorte), como letreiro. É o único movimento da placa.

### Topo
- **Estilo:** faixa verde (56px desktop / 52px celular) com escudo de rodovia, marca "Ônibus Natal" a 20px/800 e o estado da conexão à direita.
- **Estado:** "Ao vivo" com luz redonda e idade do dado ("há 1 s") em placa-texto-2; em advertência, o estado vira plaquinha amarela com preto e a luz vira losango; neutro, a luz cai para 60%.

### Campo de linha
- **Estilo:** caixa de 52px com borda de 2px em asfalto e cantos de 8px. À esquerda, o rótulo "Linha" é uma plaquinha verde (14px/700); no meio, o número a 22px/800; à direita, o botão limpar (44px) e o botão "Ver" em asfalto com letra no tom do chão (16px/800).
- **Foco:** anel de 3px em `--foco` com 2px de afastamento na caixa inteira (`:focus-within`). Cursor de digitação verde de dia, amarelo à noite.
- **Erro:** mensagem ligada por `aria-describedby` e `aria-invalid`; o aviso de erro aparece logo abaixo.

### Buttons
- **Forma:** cantos de 8px, borda de 2px, altura mínima de 48px, padding 0 14px, 15px/700, ícone de 20px com 8px de distância.
- **Padrão:** chão com borda em asfalto. Hover (só com mouse): chão-2.
- **Principal:** verde com letra branca, largura total, 16px ("Paradas perto de mim"). Hover: verde-escuro. Desabilitado: 75% e cursor de progresso.
- **Secundário:** borda em Contorno Forte ("Trocar ponto", "Esquecer este ponto").
- **Estrela (favorita):** quadrado de 52px com borda de Contorno Forte; ativa, vira amarela com estrela preta preenchida.
- **Controles do mapa:** quadrados de 44px no chão com Sombra; o de tema noite, quando ativo, fica verde.
- **Expandir ("Todas as paradas"):** faixa de 48px em chão-2, sem borda, com chevron que gira 180° ao abrir.

### Chips
- **Linha favorita:** botão de 48px de altura e no mínimo 56px de largura, borda de 2px em asfalto, número a 20px/800 tabular; abaixo, os destinos da linha a 13px/600 em texto-2 ("Planalto · Praia do Meio · Mae Luiza"), com reticências. Recentes não repetem as favoritas.
- **Linha recente:** mesma forma, borda em Contorno Forte e peso 700.

### Listas
- **Paradas:** itens de 56px separados por régua de 1px, sem cartão. Nome a 16px/700; sentidos a 14px com quadradinho de cor; distância à direita a 15px/700 tabular. Hover: chão-2.
- **Frota:** mesma régua; quadradinho de 14px, destino a 15px/700 com reticências, "ônibus nº" a 13px em texto-3; velocidade à direita com o número a 20px/800. "medindo…" e "parado há X min" em texto-3.
- **Selecionado (frota):** a linha inteira se inverte (fundo asfalto, letra no tom do chão, cantos de 4px), como placa; o quadradinho ganha filete do chão.

### Avisos
- **Erro:** placa de regulamentação: borda vermelha de 2px, fundo reg-fundo, anel vermelho à frente, texto em asfalto, 15px/1.4.
- **Advertência:** amarelo com preto, cantos de 8px (aviso) ou 4px (nota sob a placa).
- **Nota de estimativa:** 14px em texto-3, logo abaixo da placa, começando pela idade do dado em texto-2/700 ("Posições de há 12 s. Tempo estimado pela distância até o ponto, a ~18 km/h").
- **Legenda ("Como ler o mapa"):** `details` fechado por padrão, com chevron como o botão Expandir; explica as cores de sentido, o cinza sem rota, a seta do marcador, o rótulo verde, a letra do rumo e "medindo…". Os atalhos de teclado moram aqui (só com `hover: hover` e `pointer: fine`); nada de significado fica só em `title`.
- **Toast:** invertido (asfalto com letra no tom do chão), 15px/600, centralizado; no celular sobe acima da gaveta.

### Gaveta (celular)
- **Alça:** área de 44px, traço de 44×5px em Contorno Forte; arrasta por ponteiro e alterna as alturas com clique, Enter ou Espaço (o clique que segue um toque é ignorado).
- **Frota:** recolhida sob o título "Ônibus que vêm pra cá (N)" quando há placa, aberta sem ela; ordenada pelo tempo até o ponto, com "chega em X min" ao lado do número.
- **Movimento:** `transform` em 0,32s com cubic-bezier(0.22, 1, 0.36, 1); os controles do mapa acompanham na mesma curva.

### Marcadores do mapa
- **Ônibus:** quadrado na cor do sentido com seta branca no rumo. Sem rótulo, para não se atropelarem; o ônibus seguido pela placa ganha plaquinha verde com o tempo ("6 min", "chegando") e o selecionado, plaquinha invertida com número e velocidade. Selecionado: cresce 1,2× e ganha anel de asfalto de 3px. A cor vem da mesma regra da lista: sentido inferido ou, sem ele, o único itinerário da API.
- **Parada:** alvo de 44px com desenho pequeno no centro; abaixo do zoom 15 o desenho vira pontinho de 8px, para não cobrir o traçado. Ativa, mini placa verde com filete.
- **Passageiro:** ponto de 18px em asfalto com borda branca de 3px.
- **Traçado:** linha cheia na cor do sentido sobre contorno 4px mais largo na cor do chão, como mapa de rota impresso. O primeiro sentido tem 8px e o segundo 3,5px por dentro dele (os demais, 2,5px): no tronco comum de ida e volta aparecem as duas cores.

### Limites conhecidos
- O mapa-base (Esri Light/Dark Gray) é de terceiros e não segue as cores do sistema.
- O arrasto da gaveta e a pinça só foram testados em Chromium (toque sintetizado); Safari e aparelho físico não foram testados.
- O marcador de ônibus tem 28px, abaixo do alvo de 44px; a lista da frota (itens de 56px, com teclado) é o caminho acessível equivalente.

## Do's and Don'ts

### Do:
- **Do** colocar a resposta principal de cada tela numa placa de indicação: verde (#00653a), filete branco inset de 2px a 4px da borda, cantos de 8px.
- **Do** manter o verde das placas e do topo idêntico nos dois temas; à noite, troque só os tokens de chão, linha e texto.
- **Do** usar amarelo de advertência só com preto por cima, e vermelho de regulamentação só como borda/anel sobre fundo pálido.
- **Do** escrever todo número que muda com algarismos tabulares e o número principal em 800.
- **Do** repetir a cor do sentido do traçado em todo lugar que se refere àquele sentido, usando a paleta do tema atual.
- **Do** separar itens de lista com régua de 1px e marcar seleção invertendo a linha (fundo asfalto).
- **Do** manter alvos de toque de 44px ou mais (48px em botões, 56px em itens de lista) e levar os controles do mapa junto com a gaveta no celular.
- **Do** usar a curva cubic-bezier(0.22, 1, 0.36, 1) para movimentos de estado e desligar animações com `prefers-reduced-motion`.

### Don't:
- **Don't** usar brilho, neon, halo colorido ou glassmorphism; o sistema recusa o visual de painel de telemetria escuro.
- **Don't** empilhar cartões brancos com sombra para listas, nem usar um azul genérico como cor de destaque da interface.
- **Don't** usar o amarelo ou o vermelho como decoração ou destaque sem o papel de advertência, favorita, seleção de texto ou erro.
- **Don't** escurecer ou dessaturar o verde das placas no tema noite.
- **Don't** introduzir uma segunda família tipográfica nem caixa-alta em destinos e títulos.
- **Don't** pôr sombra em elementos dentro do painel; profundidade é só para o que flutua sobre o mapa e para a placa.
