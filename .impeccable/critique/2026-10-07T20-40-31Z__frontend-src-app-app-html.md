---
target: tela principal (app.html) após redesign
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\Hebert\\Documents\\Projetos\\onibus-natal\\frontend\\src\\app\\app.html"
target_fingerprint: "sha256:d3fd0c977d91e4707ef232b4815e452d63ae8c6b72ad86bdcd2cb1bb10ef9d9d"
target_path: "C:\\Users\\Hebert\\Documents\\Projetos\\onibus-natal\\frontend\\src\\app\\app.html"
timestamp: 2026-10-07T20-40-31Z
slug: frontend-src-app-app-html
---
# Crítica: tela principal após o redesign "placas de rua" (frontend/src/app/app.html)

Método: dual-agent (A: revisão de design · B: detector + Chrome headless via CDP). Overlay só em headless.

## Nota (Nielsen)
| # | Heurística | Nota | Problema principal |
|---|---|---|---|
| 1 | Visibilidade do estado | 3 | Previsão saltou 19→39 min sem dizer que o ônibus de referência mudou |
| 2 | Mundo real | 3 | "CDN70001" opaco; seta indica o ônibus, não o passageiro; mesma ↙ nas duas linhas |
| 3 | Controle e liberdade | 3 | ✕ da linha descarta o ponto; desfavoritar sem desfazer |
| 4 | Consistência | 2 | Cor de sentido diverge mapa × lista; estrela × meu ponto; Recentes repete Favoritas |
| 5 | Prevenção de erros | 3 | Paradas sobrepostas no mapa |
| 6 | Reconhecer vs. lembrar | 2 | Precisa saber a linha; favorita sem destino; meu ponto fora da inicial |
| 7 | Flexibilidade | 3 | Deep links, meu ponto automático, atalhos |
| 8 | Estética | 3 | Painel forte; mapa com anéis pretos e rótulos colidindo |
| 9 | Recuperação de erros | 3 | Erros claros com próximo passo |
| 10 | Ajuda | 2 | Significados só em title |
| **Total** | | **27/40** | **Bom** (antes 23) |

## Especificidade
Específico: escudo, placa verde, amarelo de advertência, Overpass 800 — coerente no painel. O mapa segue genérico (anéis pretos, rótulos de km/h colidindo). Detector: fonte limpa (0); página real com falsos positivos (escudo 2,3:1 amostrou o fundo; crédito Leaflet; overflow clip intencional), repeated-container-text (destinos repetidos em toda parada), layout-transition pequeno (mapa.scss:130-133), .dica 14px de margem. Glow neon sumiu.

## Pontos fortes
1. Placa de chegada (~7:1, 40/800 tabular, detalhe honesto, nota ~18 km/h).
2. Sistema de atualização dos dados (topo, aviso amarelo, medindo…, parado há X min).
3. Ergonomia: alvos ≥44 px (exceto alça), controles acima da gaveta, foco 3 px, reduced-motion, tokens dia/noite.

## Problemas prioritários
- [P1] Live region regravada a cada segundo: indicador (app.ts:159) depende de idadeS e devolve objeto novo; effect app.ts:189-192 reescreve "Ao vivo" e apaga "chegando" (app.ts:501). Fix: equal por tipo+rotulo; região assertive para chegando. → harden
- [P1] Cor de sentido mapa × lista: lista usa fallback do itinerário da API (app.ts:126), marcador não. Fix: mesma regra nos dois; rotas sobrepostas com offset. → harden
- [P1] Previsão troca de ônibus em silêncio (19→39 min). Fix: mostrar o ônibus seguido e idade do dado na placa; anunciar "o anterior já passou"; destacar no mapa. → clarify + harden
- [P2] Mapa ilegível no zoom da linha (128 anéis, rótulos colidindo). Fix: pontos pequenos abaixo do zoom limite; rótulo só do selecionado/próximo com previsão; culling. → layout
- [P2] Gaveta no celular: Salvar/Trocar em y=842/844; alça sem (click) (app.html:75-92) e 40 px. Fix: click com guarda, 44 px, Trocar no cabeçalho da placa. → adapt

## Personas
Casey: ações fora da tela, sem SW, carregamento só texto. Sam: anúncio a cada segundo, paradas keyboard:false, ordem de Tab com controles do mapa primeiro, tooltips, rótulos 12 px. Jordan: fluxo do ponto só depois da linha; cores/setas sem legenda; CDN70001. Passageiro ao sol: placa legível; rótulos do mapa somem; mesma ↙ não indica lado da rua.

## Menores
Frota por ID e não por previsão; favorita sem destino; Recentes = Favoritas; topo vazio sem escudo; aviso de geolocalização grande; "Ver" ambíguo; rodapé de atalhos fixo; cinza "sem rota" sem legenda; .dica 14 px; para.py não rastreado.

## Perguntas
1. Por que 10 linhas de frota por ID ficam sob a placa?
2. Seta do ônibus ou "lado da rua / sentido Centro"?
3. Número que dobra em silêncio ou faixa "~20–40 min"?
