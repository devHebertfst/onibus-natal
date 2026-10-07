---
target: tela principal (app.html)
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:C:\\Users\\Hebert\\Documents\\Projetos\\onibus-natal\\frontend\\src\\app\\app.html"
target_fingerprint: "sha256:7f80c254072644b01efed6c165cfefed2625036e3285c2da6cc0e912dc84fa63"
target_path: "C:\\Users\\Hebert\\Documents\\Projetos\\onibus-natal\\frontend\\src\\app\\app.html"
timestamp: 2026-10-07T18-52-15Z
slug: frontend-src-app-app-html
---
# Crítica: tela principal (frontend/src/app/app.html)

Método: dual-agent (A: revisão de design · B: detector + navegador headless via CDP). Sem navegador visível; overlay injetado só em headless.

## Nota (Nielsen)
| # | Heurística | Nota | Problema principal |
|---|---|---|---|
| 1 | Visibilidade do estado | 3 | Selo de idade excelente; marca diz "ao vivo" sem nada carregado; toggle de mapa sem estado |
| 2 | Mundo real | 2 | ID do veículo como título; nome da parada = endereço com CEP e "Brazil" |
| 3 | Controle e liberdade | 3 | Esc/X/deep link ok; gaveta só pela alça 56×20; erro fatal apaga a busca |
| 4 | Consistência | 2 | "Mapa claro" troca só os tiles; tabs sem tabpanel/setas; atalhos de teclado no celular |
| 5 | Prevenção de erros | 2 | Paradas de ida/volta sobrepostas → sentido errado, "Nenhum ônibus a caminho" |
| 6 | Reconhecer vs. lembrar | 1 | Exige saber o número da linha; sem paradas perto de mim / bairro |
| 7 | Flexibilidade | 3 | ?linha=, favoritas, atalhos; falta "meu ponto" |
| 8 | Estética/minimalismo | 3 | Calmo; marca no topo, legenda redundante, rodapé técnico |
| 9 | Recuperação de erros | 2 | "Nenhum ônibus a caminho" sem saída; erros do backend crus |
| 10 | Ajuda | 2 | Sem legenda do mapa |
| **Total** | | **23/40** | **Aceitável** |

## Especificidade
Identidade está no comportamento (dead reckoning, honestidade dos dados), não no visual (dashboard de telemetria escuro genérico, glow neon). Composição desktop-first; caso "passageiro no ponto" sem tela própria. Detector: 1 achado na fonte (layout-transition app.scss:607); na página real 19× dark-glow (mapa.scss:58-60, app.scss:45/332/135), texto 10px (.marca p), contraste baixo real na dica vazia e no rodapé (~2,5:1). Falsos positivos: atribuição Leaflet, overflow hidden, contraste do título "Ônibus".

## Pontos fortes
1. Honestidade dos dados projetada (app.html:16-24, 198-210, 274).
2. Um passo da intenção ao movimento (deep link, recentes, favoritas, atalho do manifest).
3. Fundamentos: :focus-visible, reduced-motion, safe-area, inputmode numeric, aria-labels.

## Problemas prioritários
- [P0] Resposta "quanto falta?" depende de tocar parada de 8px (mapa.ts:253) sobreposta; inacessível por teclado/leitor (keyboard:false mapa.ts:158,275). Fix: alvo ≥44px, fundir paradas ida/volta, "Paradas perto de mim", lista focável. → shape, harden
- [P1] Modo sol é meio tema: alternarEstilo (app.ts:207) só troca tiles; UI escura, texto 11px. Fix: troca completa de tokens, ≥13–14px, aria-pressed. → colorize, typeset
- [P1] Mobile = painel desktop espremido: cartão no topo (app.scss:645) cobre controle; gaveta recolhida sem a resposta; alvos 20–40px. Fix: previsão dentro da gaveta, gaveta arrastável, alvos ≥44. → adapt, layout
- [P1] Leitor de tela anuncia a cada segundo (role=status app.html:17, aria-live app.html:242 + tique()); tabs quebradas. Fix: anunciar só transições; padrão de tabs. → audit, harden
- [P2] Copy fala modelo de dados: ID como título, CEP/"Brazil", "calculando velocidades…" escondendo "N em movimento", rodapé de servidor, atalhos no touch, "AO VIVO" vazio. → clarify

## Personas
Casey: alvos <44px, resposta no topo, sem service worker, reconectando = selo 11px.
Sam: sem acesso a parada/ônibus, live regions a cada segundo, label da alça fixo, foco não vai ao cartão, cinza 11px.
Jordan: precisa saber a linha, sem legenda, Favoritas antes de tudo.
Passageiro no sol: UI escura sobre mapa claro, ETA vermelho 16px, paradas sobrepostas, sem "estou neste ponto".

## Menores
Tooltip persiste no mobile; rótulos colidem; todos os ônibus na cor "Praia do Meio" (verificar sentidos()); pulso ao vivo em vermelho-erro; rgb fixo em .status/.marca; parada #fff some no tema claro (styles.scss:150); theme-color/color-scheme fixos; max-height → transform.

## Perguntas
1. Por que a primeira tela é busca por número e não "seu ponto e próximos ônibus"?
2. O deslizar serve ao usuário ou à demo?
3. Como seria uma identidade feita para a luz do dia?
