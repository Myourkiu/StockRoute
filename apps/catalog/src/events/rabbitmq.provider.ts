import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type Provider,
} from '@nestjs/common';
import {
  type ClientProxy,
  ClientProxyFactory,
  type RmqOptions,
  Transport,
} from '@nestjs/microservices';

export const CATALOG_EVENTS_CLIENT = Symbol('CATALOG_EVENTS_CLIENT');

// Fila do indexador da busca: durável e com mensagens persistentes, para um
// restart do broker não apagar eventos ainda não consumidos.
export const INDEXER_QUEUE = 'catalog.indexer';

// Sem timeout, o amqplib espera para sempre um broker que aceita a conexão e
// não responde. E o `close()` do amqp-connection-manager espera essa conexão
// pendente: o shutdown do catalog travaria junto com o broker.
const CONNECT_TIMEOUT_MS = 5000;

function queueOptions(url: string): RmqOptions['options'] {
  return {
    urls: [url],
    queue: INDEXER_QUEUE,
    queueOptions: { durable: true },
    persistent: true,
    socketOptions: { connectionOptions: { timeout: CONNECT_TIMEOUT_MS } },
  };
}

// Sem `CATALOG_RABBITMQ_URL` a publicação fica desligada (`null`), como o
// cache sem Redis: a escrita funciona, e só a busca deixa de ser atualizada.
// O client conecta na primeira publicação, e não na subida.
export function createEventsClient(
  url: string | undefined,
): ClientProxy | null {
  if (!url) {
    new Logger('RabbitMQ').warn(
      'CATALOG_RABBITMQ_URL not set: product events disabled',
    );
    return null;
  }
  return ClientProxyFactory.create({
    transport: Transport.RMQ,
    options: queueOptions(url),
  });
}

export const eventsClientProvider: Provider = {
  provide: CATALOG_EVENTS_CLIENT,
  useFactory: () => createEventsClient(process.env.CATALOG_RABBITMQ_URL),
};

// Consumidor do indexador. Ack manual: a mensagem só sai da fila depois de
// processada. Prefetch de 10 limita quantas ficam em processamento ao mesmo
// tempo.
export function indexerConsumerOptions(url: string): RmqOptions {
  return {
    transport: Transport.RMQ,
    options: { ...queueOptions(url), noAck: false, prefetchCount: 10 },
  };
}

// Fecha a conexão no shutdown, para o processo (e os testes) terminarem limpos.
@Injectable()
export class EventsClientShutdown implements OnApplicationShutdown {
  constructor(
    @Inject(CATALOG_EVENTS_CLIENT) private readonly client: ClientProxy | null,
  ) {}

  async onApplicationShutdown() {
    await this.client?.close();
  }
}
