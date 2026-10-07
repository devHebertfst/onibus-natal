---
version: 1
slug: "frontend-src-app-app-html"
primary_target: "frontend/src/app/app.html"
related_targets: ["frontend/src/app/app.scss","frontend/src/styles.scss"]
---

# Tela principal (mapa + painel) — fluxo do ponto

Escopo: tela única do PWA, modo **Operate**. Mapa em tela cheia é intocável (pedido do usuário).
Público: passageiro no abrigo, sol forte, uma mão; e quem planeja a saída em casa.
Tarefa: linha → meu ponto → "quanto falta", em ≤2 toques na 1ª vez e 0 depois (ponto lembrado por linha, `?linha=&parada=`).
Prova: ônibus andando no mapa e o tempo da placa caindo junto; idade do dado sempre visível; previsão marcada como estimativa a 18 km/h.
Restrições: sem conta; dados só no navegador; backend inalterado; sem gerador de imagem (code-led).
Em aberto: nomes de bairro/ponto de referência não existem na API — não inventar.

## Direction contract

THESIS: o cartão do ponto é uma placa de indicação brasileira de verdade — verde, filete branco interno, seta e destino, tempo grande — e recusa o padrão da categoria (painel de telemetria escuro com neon, ou cartões brancos genéricos com um azul).

OWN-WORLD: sinalização viária CONTRAN. Overpass (herdeira aberta da letra de rodovia) com algarismos tabulares; verde-indicação #00653a como casca (topo, placa do ponto), branco e asfalto #1b1f22 no chão do dia, asfalto #111416 no da noite com placas que continuam acesas (refletivas); amarelo-advertência #ffc20e com preto para atrasado/reconectando; filete vermelho-regulamentação #c4161c para erro; sentidos em azul-serviço #1859c2 e laranja-obras #d9590b. Cantos de placa (8px), filete branco inset, sem brilhos.

STORY: o passageiro abre a linha, vê "Seu ponto" com as paradas perto dele, toca uma e lê na placa "4 min · a 3 paradas"; salva como meu ponto; amanhã abre e a placa já está lá.

FIRST VIEWPORT: celular — mapa cheio; topo verde estreito com escudo da linha, estado da conexão e idade do dado; gaveta inferior na altura mínima já mostrando a placa do ponto (ou "Seu ponto" com o botão de localização). Desktop — painel esquerdo 400px com a mesma ordem: busca, placa, paradas, frota.

FORM: placas de sinalização viária brasileiras; posição 1 da lista própria (IMPECCABLE'S PICK escolhido pelo usuário sobre a sorteada nº 7, renda de bilro); seed key fdc82273 (roll degradado, sem desafiantes). Assinatura: a placa de chegada.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
