import type { INestApplication, INestMicroservice } from '@nestjs/common';
import { Transport } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import type { AddressInfo, Server } from 'node:net';
import request from 'supertest';
import type { App } from 'supertest/types';
import { CatalogModule } from '../../catalog/src/catalog.module';
import { ErpMockModule } from '../../erp-mock/src/erp-mock.module';
import { IntegrationModule } from '../../integration/src/integration.module';
import { OrdersModule } from '../../orders/src/orders.module';
import { GatewayModule } from '../src/gateway.module';

// Gateway real (HTTP) agregando os quatro serviços reais: catalog, orders e
// integration por TCP e o erp-mock por HTTP, cada um numa porta livre. O
// gateway recebe as portas pelas mesmas variáveis de ambiente de fora dos testes.
describe('GET /health (e2e)', () => {
  const tcpServices = {
    CATALOG: CatalogModule,
    ORDERS: OrdersModule,
    INTEGRATION: IntegrationModule,
  };
  const started: Record<string, INestMicroservice> = {};
  let erpMock: INestApplication;
  let gateway: INestApplication<App>;

  beforeAll(async () => {
    for (const [prefix, module] of Object.entries(tcpServices)) {
      const moduleRef = await Test.createTestingModule({
        imports: [module],
      }).compile();
      const service = moduleRef.createNestMicroservice({
        transport: Transport.TCP,
        options: { host: '127.0.0.1', port: 0 },
      });
      await service.listen();
      const { port } = service.unwrap<Server>().address() as AddressInfo;
      process.env[`${prefix}_TCP_HOST`] = '127.0.0.1';
      process.env[`${prefix}_TCP_PORT`] = String(port);
      started[prefix] = service;
    }

    const erpMockRef = await Test.createTestingModule({
      imports: [ErpMockModule],
    }).compile();
    erpMock = erpMockRef.createNestApplication();
    await erpMock.listen(0, '127.0.0.1');
    process.env.ERP_MOCK_URL = await erpMock.getUrl();

    const gatewayRef = await Test.createTestingModule({
      imports: [GatewayModule],
    }).compile();
    gateway = gatewayRef.createNestApplication();
    await gateway.init();
  });

  afterAll(async () => {
    await gateway.close();
    await erpMock.close();
    await Promise.all(Object.values(started).map((service) => service.close()));
    for (const prefix of Object.keys(tcpServices)) {
      delete process.env[`${prefix}_TCP_HOST`];
      delete process.env[`${prefix}_TCP_PORT`];
    }
    delete process.env.ERP_MOCK_URL;
  });

  it('responde 200 com os quatro serviços up', async () => {
    const response = await request(gateway.getHttpServer()).get('/health');

    expect(response.status).toBe(200);
    for (const service of ['catalog', 'orders', 'integration', 'erp-mock']) {
      expect(response.body.details[service].status).toBe('up');
    }
  });

  it('responde 503 em menos de 3 s com orders down e os demais up quando orders para', async () => {
    await started.ORDERS.close();
    const startedAt = Date.now();

    const response = await request(gateway.getHttpServer()).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.details.orders.status).toBe('down');
    for (const service of ['catalog', 'integration', 'erp-mock']) {
      expect(response.body.details[service].status).toBe('up');
    }
    expect(Date.now() - startedAt).toBeLessThan(3000);
  });
});
