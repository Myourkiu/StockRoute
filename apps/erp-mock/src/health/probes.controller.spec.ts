import { INestApplication } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { ProbesController } from './probes.controller';

// Probes do erp-mock: sem dependências, live e ready respondem só sobre o
// processo (CA08).
describe('ProbesController (erp-mock)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [ProbesController],
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

  it('GET /health/ready responde 200, porque o erp-mock não tem dependências', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready');

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
