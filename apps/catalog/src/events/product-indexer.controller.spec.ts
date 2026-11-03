import { Logger } from '@nestjs/common';
import type { RmqContext } from '@nestjs/microservices';
import { ProductIndexerController } from './product-indexer.controller';
import type { ProductIndexer } from './product-indexer';

const ID = '33333333-3333-4333-8333-333333333333';

function rmqContext() {
  const message = { content: Buffer.from('{}') };
  const ack = jest.fn<void, [unknown]>();
  const context = {
    getChannelRef: () => ({ ack }),
    getMessage: () => message,
  } as unknown as RmqContext;
  return { context, ack, message };
}

// Consumidor do evento (T03): sempre dá ack, com sucesso ou com erro. Sem
// dead-letter queue, devolver a mensagem para a fila a faria voltar em loop; a
// reindexação corrige o que se perder (D16).
describe('ProductIndexerController', () => {
  let sync: jest.Mock<
    ReturnType<ProductIndexer['sync']>,
    Parameters<ProductIndexer['sync']>
  >;
  let controller: ProductIndexerController;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    sync = jest.fn();
    controller = new ProductIndexerController({
      sync,
    } as unknown as ProductIndexer);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    warn.mockRestore();
    error.mockRestore();
  });

  it('evento válido → sincroniza o produto e dá ack uma vez', async () => {
    const { context, ack, message } = rmqContext();
    sync.mockResolvedValue();

    await controller.onProductUpserted(
      { productId: ID, occurredAt: '2026-11-02T12:00:00.000Z' },
      context,
    );

    expect(sync).toHaveBeenCalledWith(ID);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledWith(message);
  });

  it('sincronização que falha → dá ack uma vez, sem relançar', async () => {
    const { context, ack } = rmqContext();
    sync.mockRejectedValue(new Error('inesperado'));

    await expect(
      controller.onProductUpserted(
        { productId: ID, occurredAt: '2026-11-02T12:00:00.000Z' },
        context,
      ),
    ).resolves.toBeUndefined();
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['sem productId', { occurredAt: '2026-11-02T12:00:00.000Z' }],
    ['com id que não é UUID', { productId: 'abc' }],
    ['nulo', null],
    ['texto', 'produto'],
  ])('payload %s → ack e aviso, sem sincronizar', async (_label, payload) => {
    const { context, ack } = rmqContext();

    await controller.onProductUpserted(payload, context);

    expect(sync).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });
});
