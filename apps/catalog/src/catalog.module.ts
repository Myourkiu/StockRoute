import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { ProductCache } from './cache/product-cache';
import {
  productCacheOptionsProvider,
  redisProvider,
  RedisShutdown,
} from './cache/redis.provider';
import { ProductEvents } from './events/product-events';
import { ProductIndexer } from './events/product-indexer';
import { ProductIndexerController } from './events/product-indexer.controller';
import {
  EventsClientShutdown,
  eventsClientProvider,
} from './events/rabbitmq.provider';
import { HealthController } from './health/health.controller';
import { ProbesController } from './health/probes.controller';
import { PrismaService } from './prisma/prisma.service';
import { ProductsController } from './products/products.controller';
import { ProductsRepository } from './products/products.repository';
import { ProductsService } from './products/products.service';
import {
  ElasticsearchShutdown,
  elasticsearchProvider,
} from './search/elasticsearch.provider';
import { ProductIndex } from './search/product-index';

// Redis, RabbitMQ e Elasticsearch são opcionais: sem a URL de cada um, o
// provider devolve `null` e a funcionalidade fica desligada (cache, eventos ou
// busca), sem impedir o catalog de subir.
@Module({
  imports: [TerminusModule],
  controllers: [
    HealthController,
    ProbesController,
    ProductsController,
    ProductIndexerController,
  ],
  providers: [
    PrismaService,
    ProductsRepository,
    ProductsService,
    redisProvider,
    productCacheOptionsProvider,
    ProductCache,
    RedisShutdown,
    eventsClientProvider,
    ProductEvents,
    EventsClientShutdown,
    elasticsearchProvider,
    ProductIndex,
    ElasticsearchShutdown,
    ProductIndexer,
  ],
})
export class CatalogModule {}
