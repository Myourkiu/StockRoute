import { Logger } from '@nestjs/common';
import type { ClientProxy } from '@nestjs/microservices';
import { CATALOG_EVENTS } from '@stockroute/contracts';
import { NEVER, of, throwError } from 'rxjs';
import { ProductEvents } from './product-events';

const ID = '33333333-3333-4333-8333-333333333333';

function mockClient() {
  return {
    emit: jest.fn<
      ReturnType<ClientProxy['emit']>,
      Parameters<ClientProxy['emit']>
    >(),
  };
}

// Publicação do evento de produto (T03): dispara e não espera. A escrita já
// foi confirmada no banco; um broker fora ou lento só vira log (D16).
describe('ProductEvents', () => {
  let client: ReturnType<typeof mockClient>;
  let events: ProductEvents;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    client = mockClient();
    events = new ProductEvents(client as unknown as ClientProxy);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
    warn.mockRestore();
  });

  it('emite o padrão do contrato com o id e a data em ISO 8601', () => {
    jest.useFakeTimers({ now: new Date('2026-11-02T12:00:00.000Z') });
    client.emit.mockReturnValue(of(undefined));

    events.publishUpserted(ID);

    expect(client.emit).toHaveBeenCalledWith(CATALOG_EVENTS.productUpserted, {
      productId: ID,
      occurredAt: '2026-11-02T12:00:00.000Z',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('emit que falha → aviso no log, sem exceção', () => {
    client.emit.mockReturnValue(throwError(() => new Error('broker fora')));

    expect(() => events.publishUpserted(ID)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('broker fora'));
  });

  it('emit que nunca termina → retorna na hora, e o timeout de 5 s só é logado', () => {
    jest.useFakeTimers();
    client.emit.mockReturnValue(NEVER);

    events.publishUpserted(ID);

    expect(warn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(5000);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(ID));
  });

  it('sem broker configurado → nada é emitido, sem erro', () => {
    const disabled = new ProductEvents(null);

    expect(() => disabled.publishUpserted(ID)).not.toThrow();
  });
});
