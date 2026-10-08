import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { NubusClient } from './../src/nubus/nubus.client.js';
import { respostaTrajeto } from './fixtures/trajeto.js';

describe('GET /api/linhas/:numero (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(NubusClient)
      .useValue({
        pesquisarRotas: async (n: string) =>
          n === '33' || n === '3'
            ? [
                {
                  codigoItinerario: 1,
                  descricaoItinerario: 'IDA',
                  codigolinha: 'CDNO-33',
                  descricaolinha: 'O-33',
                },
              ]
            : [],
        paradasEspecifica: async () => ({
          pontos: '-5.80 -35.20|-5.81 -35.21',
          paradas: [
            {
              codigo: 'PARADA#1',
              Lat: -5.8,
              Long: -35.2,
              descricao: 'Rua A',
              ordem: 1,
            },
          ],
          carros: [{ carro: 'X', Lat: -5.805, Long: -35.205 }],
        }),
        listarParadas: async () => [
          { codigo: 'PARADA#1', Lat: -5.8, Long: -35.2, descricao: 'Rua A' },
        ],
        previsaoParada: async () => [
          {
            Carro: 'X',
            tipo: 'On-line',
            Minutos: 5,
            distanciaVeiculoMetros: 1500,
          },
        ],
        planejarTrajeto: async () => respostaTrajeto(),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  it('devolve a linha consolidada', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/linhas/33')
      .expect(200);
    expect(res.body.onibus).toHaveLength(1);
    expect(res.body.itinerarios[0].tracado).toHaveLength(2);
  });

  it('lista o catálogo sem iniciar o acompanhamento de linhas', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/linhas/catalogo')
      .expect(200);
    expect(res.body).toEqual([{ numero: '33', descricoes: ['IDA'] }]);
    const acompanhadas = await request(app.getHttpServer())
      .get('/api/linhas')
      .expect(200);
    expect(acompanhadas.body).toEqual([]);
  });

  it('consulta a previsão oficial e valida o vínculo da parada com o itinerário', async () => {
    const r = await request(app.getHttpServer())
      .get('/api/linhas/33/previsao')
      .query({ itinerario: '1', parada: 'PARADA#1' })
      .expect(200);
    expect(r.body.chegadas[0]).toMatchObject({
      onibus: 'X',
      aoVivo: true,
      metros: 1500,
    });
    await request(app.getHttpServer())
      .get('/api/linhas/33/previsao')
      .query({ itinerario: '1', parada: 'PARADA#999' })
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/linhas/33/previsao')
      .expect(400);
  });

  it('encontra paradas e linhas próximas e recusa coordenadas vazias', async () => {
    const r = await request(app.getHttpServer())
      .get('/api/paradas/proximas')
      .query({ lat: -5.8, lng: -35.2 })
      .expect(200);
    expect(r.body[0]).toMatchObject({
      codigo: 'PARADA#1',
      linhas: [{ numero: '33' }],
    });
    await request(app.getHttpServer())
      .get('/api/paradas/proximas')
      .query({ lat: '', lng: -35.2 })
      .expect(400);
    await request(app.getHttpServer()).get('/api/paradas/proximas').expect(400);
  });

  it('planeja caminhada e ônibus e valida os parâmetros HTTP', async () => {
    const query = {
      from_lat: -5.7945,
      from_lng: -35.211,
      to_lat: -5.835,
      to_lng: -35.207,
      datetime: '2026-10-08T08:00',
    };
    const r = await request(app.getHttpServer())
      .get('/api/trajetos')
      .query(query)
      .expect(200);
    expect(
      r.body.viagens[0].trechos.map((t: { modo: string }) => t.modo),
    ).toEqual(['WALK', 'BUS']);
    await request(app.getHttpServer())
      .get('/api/trajetos')
      .query({ ...query, to_lat: '' })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/trajetos')
      .query({ ...query, datetime: 'amanhã' })
      .expect(400);
  });

  it('404 para linha inexistente, 400 para número inválido', async () => {
    await request(app.getHttpServer()).get('/api/linhas/000').expect(404);
    await request(app.getHttpServer()).get('/api/linhas/a%20b').expect(400);
  });

  it('stream SSE envia a linha e encerra com evento de erro se não existir', async () => {
    await app.listen(0);
    const base = await app.getUrl();

    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/linhas/33/stream`, {
      signal: ctrl.signal,
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const leitor = res.body!.getReader();
    // Lê até passar por pings (SSE_PING_MS=200) e confirma que o fluxo segue vivo.
    let texto = '';
    while ((texto.match(/: ping/g) ?? []).length < 2) {
      const { value } = await leitor.read();
      texto += new TextDecoder().decode(value);
    }
    ctrl.abort();
    expect(texto).toContain('event: linha');
    expect(texto).not.toContain('event: error');
    const dados = JSON.parse(/data: (.*)/.exec(texto)![1]);
    expect(dados.onibus).toHaveLength(1);

    const erro = await (await fetch(`${base}/api/linhas/000/stream`)).text();
    expect(erro).toContain('event: erro');
    expect(erro).toContain('"status":404');
  });

  afterEach(async () => {
    await app.close();
  });
});
