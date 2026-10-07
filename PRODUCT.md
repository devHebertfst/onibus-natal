# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

PWA instalável (manifest, `display: standalone`, orientação retrato). Uso principal no celular; o desktop também é suportado (painel lateral, atalhos de teclado).

## Users

Moradores de Natal/RN que andam de ônibus, em duas situações com o mesmo peso:

- **No ponto:** esperando na rua, no celular, muitas vezes sob sol forte e com uma mão só. A pergunta é "quanto falta pro meu ônibus?".
- **Planejando:** em casa ou no trabalho, decidindo a hora de sair a partir de onde o ônibus está agora.

## Product Purpose

Mostrar os ônibus de Natal se movendo no mapa em tempo real, a partir da API pública Nubus, com a frota de cada linha, a velocidade de cada veículo e a previsão de chegada nas paradas. O sucesso é o passageiro saber, com confiança, quando sair de casa ou quanto ainda vai esperar no ponto.

## Positioning

O que o separa do app oficial, do Moovit e do Google Maps:

- **Movimento contínuo:** os ônibus andam suavemente pelo traçado (dead reckoning com correção exponencial), em vez de pular a cada leitura de GPS (~30 s).
- **Rapidez e leveza:** abre direto na linha (`?linha=33`), sem cadastro e sem anúncios; instalável como app.
- **Honestidade dos dados:** mostra a idade do último dado, o estado da conexão (ao vivo / reconectando / atrasado), "calculando…" enquanto não há velocidade e "parado há X min". Nunca finge precisão que não tem.
- **Foco local:** feito para Natal, tratando as manias reais da API Nubus (zeros à esquerda, busca por trecho, itens repetidos).

## Operating Context

- Fluxo principal: digitar o número da linha → ver traçado, paradas e ônibus → tocar num ônibus para segui-lo ou numa parada para ver os próximos com estimativa de chegada.
- Favoritas e recentes guardadas no navegador; atalho do manifest abre direto nas favoritas.
- Dados chegam por Server-Sent Events: o backend consulta a API uma vez por linha a cada 15 s e empurra cada atualização. O GPS dos veículos atualiza a cada ~30 s.
- Uso ao ar livre com luz direta é real: existe alternância entre mapa escuro e claro por esse motivo.

## Capabilities and Constraints

- **Sem conta nem login.** Tudo funciona anonimamente; dados do usuário ficam só no navegador. Restrição confirmada.
- **Legível sob sol forte e operável com uma mão.** Restrição confirmada.
- Previsão de chegada: distância pelo traçado até a parada a 18 km/h (velocidade comercial média). É uma estimativa e deve ser apresentada como tal.
- Mapas Esri Dark/Light Gray, sem chave de API.
- Backend acompanha no máximo 40 linhas (até 4 consultas em paralelo); a API de origem nunca recebe consultas por cliente.
- Terminologia: **linha** (número, ex.: 33), **itinerário** (variante/sentido de uma linha), **traçado**, **parada**, **frota**, **sentido** (ida/volta).
- Próximas fases previstas (não implementadas): busca por parada e planejador de rota a pé + ônibus, service worker para internet fraca, histórico em PostgreSQL/PostGIS, tempo de parada no dead reckoning.

## Brand Commitments

- Idioma: português do Brasil, tom direto e coloquial ("Toque numa parada do mapa para ver os próximos ônibus").
- O nome atual "Ônibus.natal", o ícone de pulso e o visual escuro com acento vermelho inspirado no [Ponto.OS](https://pontoos.com.br/) existem no código, mas **não** foram confirmados como compromissos de marca: podem mudar num redesign.

## Evidence on Hand

- Dados reais e ao vivo da API Nubus (linhas, itinerários, paradas, posições).
- Documentação técnica em `README.md` (arquitetura, decisões de dead reckoning e velocidade, formato real da API).
- Não há usuários, depoimentos, métricas de uso nem parceria com a Nubus/SETURN. Não inventar nenhum desses.

## Product Principles

1. **Verdade antes de efeito.** Movimento suave sim, precisão falsa nunca: sempre deixar visível de quando é o dado e o que é estimativa.
2. **Do toque à resposta, o mais curto possível.** Linha em um passo, sem cadastro, sem telas intermediárias.
3. **Funciona na rua.** Sol, pressa, uma mão, rede instável: o cenário do ponto de ônibus é o caso de projeto, não a exceção.
4. **Natal de verdade.** Tratar os dados e os costumes locais como são, em vez de um app genérico de trânsito.

## Accessibility & Inclusion

- Contraste suficiente para leitura ao ar livre com luz direta.
- Alvos de toque alcançáveis com uma mão no celular.
