import { Logger } from '@nestjs/common';
import { Transport } from '@nestjs/microservices';
import {
  createEventsClient,
  INDEXER_QUEUE,
  indexerConsumerOptions,
} from './rabbitmq.provider';

const URL = 'amqp://guest:guest@127.0.0.1:5672';

// Opções do RabbitMQ (fatia 3): fila durável, ack manual e prefetch no
// consumidor; timeout de conexão e reconexão curta nos dois lados, para um
// broker travado não segurar o shutdown e um broker que volta ser reconectado
// logo (os eventos publicados até lá se perdem, e a reindexação corrige).
describe('opções do RabbitMQ', () => {
  it('consumidor: fila durável, ack manual, prefetch 10, timeout de conexão de 5 s e reconexão a cada 2 s', () => {
    const options = indexerConsumerOptions(URL);

    expect(options.transport).toBe(Transport.RMQ);
    expect(options.options).toMatchObject({
      urls: [URL],
      queue: INDEXER_QUEUE,
      queueOptions: { durable: true },
      noAck: false,
      prefetchCount: 10,
      socketOptions: {
        connectionOptions: { timeout: 5000 },
        reconnectTimeInSeconds: 2,
      },
    });
  });

  it('sem URL → publicação desligada (null), com aviso', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    expect(createEventsClient(undefined)).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('CATALOG_RABBITMQ_URL'),
    );
    warn.mockRestore();
  });
});
