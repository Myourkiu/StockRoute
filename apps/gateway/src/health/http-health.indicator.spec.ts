import { HealthIndicatorService } from '@nestjs/terminus';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpHealthIndicator } from './http-health.indicator';

// Um servidor HTTP de verdade, numa porta livre, faz o papel do erp-mock:
// o que está em teste é como o indicador traduz 200, 500 e silêncio.
describe('HttpHealthIndicator', () => {
  let server: Server;
  let baseUrl: string;
  let indicator: HttpHealthIndicator;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/ok') {
        res.writeHead(200).end('{"status":"ok"}');
      } else if (req.url === '/error') {
        res.writeHead(500).end();
      }
      // /hang: nunca responde.
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    indicator = new HttpHealthIndicator(new HealthIndicatorService());
  });

  it('marca o serviço como up quando ele responde 200', async () => {
    const result = await indicator.isHealthy('erp-mock', `${baseUrl}/ok`);

    expect(result).toMatchObject({ 'erp-mock': { status: 'up' } });
  });

  it('marca o serviço como down quando ele responde 500', async () => {
    const result = await indicator.isHealthy('erp-mock', `${baseUrl}/error`);

    expect(result).toMatchObject({
      'erp-mock': { status: 'down', message: 'HTTP 500' },
    });
  });

  it('marca o serviço como down por timeout quando ele não responde em 1 s', async () => {
    const started = Date.now();

    const result = await indicator.isHealthy('erp-mock', `${baseUrl}/hang`);

    expect(result).toMatchObject({
      'erp-mock': { status: 'down', message: 'timeout of 1000ms exceeded' },
    });
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
