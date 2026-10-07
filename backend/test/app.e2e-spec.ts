import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { NubusClient } from './../src/nubus/nubus.client.js';

describe('GET /api/linhas/:numero (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(NubusClient)
      .useValue({
        pesquisarRotas: async (n: string) =>
          n === '33'
            ? [{ codigoItinerario: 1, descricaoItinerario: 'IDA' }]
            : [],
        paradasEspecifica: async () => ({
          pontos: '-5.80 -35.20|-5.81 -35.21',
          paradas: [],
          carros: [{ carro: 'X', Lat: -5.805, Long: -35.205 }],
        }),
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
