# Frontend (Angular + Leaflet)

Mapa com o traçado, as paradas e os ônibus da linha, animados por dead
reckoning. Veja o [README principal](../README.md) para a visão geral.

```bash
npm install
npm start          # http://localhost:4200 (proxy /api -> localhost:3000)
npm test           # testes (inclui a lógica de dead reckoning)
npm run build      # build de produção em dist/frontend
```

Abra direto uma linha com `http://localhost:4200/?linha=33`.
