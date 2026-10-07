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

  afterEach(async () => {
    await app.close();
  });
});
