import { HealthIndicatorService } from '@nestjs/terminus';
import type { ClientProxy } from '@nestjs/microservices';
import { HEALTH_PATTERN } from '@stockroute/contracts';
import { NEVER, of, throwError } from 'rxjs';
import { ServiceHealthIndicator } from './service-health.indicator';

// O ClientProxy é trocado por um dublê que só implementa `send`: o que está em
// teste é como o indicador traduz resposta, erro e silêncio em up/down.
function clientReturning(response: ReturnType<ClientProxy['send']>) {
  const send = jest.fn().mockReturnValue(response);
  return { client: { send } as unknown as ClientProxy, send };
}

describe('ServiceHealthIndicator', () => {
  let indicator: ServiceHealthIndicator;

  beforeEach(() => {
    indicator = new ServiceHealthIndicator(new HealthIndicatorService());
  });

  it('marca o serviço como up quando ele responde à mensagem de saúde', async () => {
    const { client, send } = clientReturning(
      of({ service: 'catalog', status: 'up' }),
    );

    const result = await indicator.isHealthy('catalog', client);

    expect(send).toHaveBeenCalledWith(HEALTH_PATTERN, {});
    expect(result).toMatchObject({ catalog: { status: 'up' } });
  });

  it('marca o serviço como down quando o client lança erro', async () => {
    const { client } = clientReturning(
      throwError(() => new Error('connect ECONNREFUSED 127.0.0.1:18101')),
    );

    const result = await indicator.isHealthy('catalog', client);

    expect(result).toMatchObject({
      catalog: {
        status: 'down',
        message: 'connect ECONNREFUSED 127.0.0.1:18101',
      },
    });
  });

  // Tempo real, não fake timers: o timeout do terminus usa AbortSignal.timeout(),
  // que roda nos timers internos do Node e não é controlado pelo Jest.
  it('marca o serviço como down por timeout quando ele nunca responde', async () => {
    const { client } = clientReturning(NEVER);
    const started = Date.now();

    const result = await indicator.isHealthy('catalog', client);

    expect(result).toMatchObject({
      catalog: { status: 'down', message: 'timeout of 1000ms exceeded' },
    });
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
