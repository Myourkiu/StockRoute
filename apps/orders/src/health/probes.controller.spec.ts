import { INestApplication } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../prisma/prisma.service';
import { ProbesController } from './probes.controller';

// Probes HTTP internas do orders, sem banco: liveness sem dependências e rota
// inexistente.
describe('ProbesController (orders)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [ProbesController],
      // Liveness e 404 não tocam o banco; o readiness com banco é coberto no
      // teste de integração (test/integration/service-db.int-spec.ts).
      providers: [{ provide: PrismaService, useValue: {} }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live responde 200 com status ok', async () => {
    const response = await request(app.getHttpServer()).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok' });
  });

  it('GET /health/inexistente responde 404', async () => {
    const response = await request(app.getHttpServer()).get(
      '/health/inexistente',
    );

    expect(response.status).toBe(404);
  });
});
