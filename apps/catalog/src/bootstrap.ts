import { type INestApplication, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import { CatalogModule } from './catalog.module';
import { indexerConsumerOptions } from './events/rabbitmq.provider';
import { ProductIndex } from './search/product-index';

export interface CatalogStartOptions {
  tcpPort: number;
  httpPort: number;
  logger?: false;
}

// App híbrida: TCP para as mensagens do gateway, HTTP interno para as probes
// e, com `CATALOG_RABBITMQ_URL`, o consumidor RMQ do indexador da busca.
//
// A subida espera só o TCP e o HTTP. O servidor RMQ do Nest só conclui o
// `listen` depois de conectar, e tenta para sempre: esperar por ele travaria o
// catalog com o broker fora. Por isso o consumidor e a criação do índice
// começam em segundo plano, e o broker e o ES continuam opcionais (regra 7).
export async function startCatalog(
  options: CatalogStartOptions,
): Promise<INestApplication> {
  const logger = new Logger('Catalog');
  const app = await NestFactory.create(CatalogModule, {
    ...(options.logger === false && { logger: false }),
  });
  const tcp = app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: { host: '0.0.0.0', port: options.tcpPort },
  });
  const rabbitUrl = process.env.CATALOG_RABBITMQ_URL;
  const consumer = rabbitUrl
    ? app.connectMicroservice<MicroserviceOptions>(
        indexerConsumerOptions(rabbitUrl),
      )
    : null;

  await tcp.listen();
  await app.listen(options.httpPort);

  consumer
    ?.listen()
    .catch((error: Error) =>
      logger.error(`Indexer consumer stopped: ${error.message}`),
    );
  app
    .get(ProductIndex)
    .ensure()
    .catch((error: Error) =>
      logger.warn(`Search index not ready yet: ${error.message}`),
    );
  return app;
}
