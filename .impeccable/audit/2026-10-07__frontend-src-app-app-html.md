# Audit técnico: tela principal (fluxo do ponto)

Alvo: `frontend/src/app/app.html` e componentes (placa, mapa), depois de shape → build → adapt → harden → clarify.
Evidência: build e testes (16/16), detector do Impeccable, contraste calculado dos tokens, capturas em Chromium headless (390×844, 320×640, 844×390 deitado, 1440×900 dia e noite) com API Nubus simulada, arrasto da gaveta com toque sintetizado via CDP (Chromium; Safari e aparelho físico não testados).

## Nota

| # | Dimensão | Nota | Achado principal |
|---|---|---|---|
| 1 | Acessibilidade | 3 | Bordas de controles secundários a 2,94:1 (< 3:1); erro do campo sem `aria-describedby`; painel como `aside` (sem `main`) |
| 2 | Desempenho | 3 | Lista da frota re-renderiza a cada 1 s (relógio); aceitável para ~20 ônibus |
| 3 | Tema | 3 | Cores dos sentidos iguais nos dois temas: azul no mapa escuro a 2,38:1 |
| 4 | Responsivo | 3 | Marcador de ônibus com 28 px (alternativa: lista da frota com 56 px); painel apertado no celular deitado |
| 5 | Integridade | 3 | 1 achado do detector (sombra colorida na abertura) — já corrigido |
| **Total** | | **15/20** | **Bom** |

## Veredito de integridade

Passa. Um mundo só (sinalização CONTRAN) aplicado por tokens nos dois temas; a placa de chegada é a assinatura e carrega dado real (rumo do traçado, paradas no caminho, estimativa declarada). Sem brilhos, sem kicker, sem cartões genéricos.

## Achados

- **[P2] Borda de controle abaixo de 3:1** — `styles.scss` `--linha-forte` (#8e989e dia, #5b656b noite) em `.estrela`, `.botao.secundario`, `.filtro`, `.chips .leve`. WCAG 1.4.11. → polish: escurecer/clarear o token.
- **[P2] Traçado azul pouco visível no mapa escuro** — `mapa.ts` `CORES` único para os dois temas. → polish: paleta da noite.
- **[P2] Erro da linha não ligado ao campo** — `app.html` `.aviso.erro`. WCAG 3.3.1. → polish: `aria-describedby` + `aria-invalid`.
- **[P2] Sem landmark principal** — `app.html` painel é `aside`. → polish: `main`.
- **[P3] Rótulos de ônibus se sobrepõem quando os veículos estão juntos** — `mapa.ts`. → fase futura (colisão de rótulos).
- **[P3] Marcadores de ônibus com 28 px** — compensado pela lista da frota (56 px, teclado). Sem ação.

## Pontos fortes

- Fluxo do ponto completo: perto de mim (com recusa de localização tratada), lista com busca sem acento, toque no mapa com alvo de 44 px, paradas de ida/volta fundidas, ponto lembrado por linha, `?linha=&parada=`.
- Leitor de tela: anúncios só em transições (conexão, ponto escolhido, "chegando"); sem abas quebradas.
- Tema completo dia/noite por tokens, sem flash (tema aplicado antes do 1º quadro).
- Erros com recuperação e campo preservado; sem internet e dado velho sinalizados em amarelo de advertência.

## Ações recomendadas

1. [P2] `/impeccable polish`: tokens de borda, paleta da noite, `aria-describedby`, `main`.
