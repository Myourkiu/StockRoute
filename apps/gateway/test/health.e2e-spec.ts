import { INestApplication, INestMicroservice } from '@nestjs/common';
import { Transport } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { AddressInfo, Server } from 'node:net';
import request from 'supertest';
import { App } from 'supertest/types';
import { CatalogModule } from '../../catalog/src/catalog.module';
import { GatewayModule } from '../src/gateway.module';

// Gateway real (HTTP) falando por TCP com um catalog real, cada um no seu
// "processo" Nest. O catalog sobe numa porta livre e o gateway recebe essa
// porta pelas mesmas variáveis de ambiente usadas fora dos testes.
describe('GET /health (e2e)', () => {
  let catalog: INestMicroservice;
  let gateway: INestApplication<App>;

  beforeAll(async () => {
    const catalogModule = await Test.createTestingModule({
      imports: [CatalogModule],
    }).compile();
    catalog = catalogModule.createNestMicroservice({
      transport: Transport.TCP,
      options: { host: '127.0.0.1', port: 0 },
    });
    await catalog.listen();

    const { port } = catalog.unwrap<Server>().address() as AddressInfo;
    process.env.CATALOG_TCP_HOST = '127.0.0.1';
    process.env.CATALOG_TCP_PORT = String(port);

    const gatewayModule = await Test.createTestingModule({
      imports: [GatewayModule],
    }).compile();
    gateway = gatewayModule.createNestApplication();
    await gateway.init();
  });

  afterAll(async () => {
    await gateway.close();
    delete process.env.CATALOG_TCP_HOST;
    delete process.env.CATALOG_TCP_PORT;
  });

  it('responde 200 com catalog up quando o catalog está no ar', async () => {
    const response = await request(gateway.getHttpServer()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.details.catalog.status).toBe('up');
  });

  it('responde 503 com catalog down em menos de 3 s quando o catalog para', async () => {
    await catalog.close();
    const started = Date.now();

    const response = await request(gateway.getHttpServer()).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.details.catalog.status).toBe('down');
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
