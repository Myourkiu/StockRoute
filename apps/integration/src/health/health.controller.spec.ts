import { INestMicroservice } from '@nestjs/common';
import {
  ClientProxy,
  ClientProxyFactory,
  Transport,
} from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { HEALTH_PATTERN, HealthResponse } from '@stockroute/contracts';
import { AddressInfo, Server } from 'node:net';
import { firstValueFrom } from 'rxjs';
import { HealthController } from './health.controller';

// Sobe o integration como microservice TCP de verdade, numa porta livre (0), e fala
// com ele por um client TCP, como o gateway fará. Assim o teste prova o
// @MessagePattern com o padrão do contrato, e não só o método do controller.
describe('HealthController (TCP)', () => {
  let server: INestMicroservice;
  let client: ClientProxy;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    server = moduleRef.createNestMicroservice({
      transport: Transport.TCP,
      options: { host: '127.0.0.1', port: 0 },
    });
    await server.listen();

    const { port } = server.unwrap<Server>().address() as AddressInfo;
    client = ClientProxyFactory.create({
      transport: Transport.TCP,
      options: { host: '127.0.0.1', port },
    });
    await client.connect();
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it('responde à mensagem de saúde com integration up', async () => {
    const response = await firstValueFrom(
      client.send<HealthResponse>(HEALTH_PATTERN, {}),
    );

    expect(response).toEqual({ service: 'integration', status: 'up' });
  });

  it('rejeita padrão desconhecido com erro de handler inexistente', async () => {
    await expect(
      firstValueFrom(client.send({ cmd: 'unknown' }, {})),
    ).rejects.toEqual(expect.stringContaining('no matching message handler'));
  });

  it('responde exatamente os campos do contrato, sem extras', async () => {
    const response = await firstValueFrom(
      client.send<HealthResponse>(HEALTH_PATTERN, {}),
    );

    const expected = {
      service: 'integration',
      status: 'up',
    } satisfies HealthResponse;
    expect(response).toStrictEqual(expected);
    expect(Object.keys(response).sort()).toEqual(['service', 'status']);
  });
});
