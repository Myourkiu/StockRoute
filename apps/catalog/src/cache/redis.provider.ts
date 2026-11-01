import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type Provider,
} from '@nestjs/common';
import Redis from 'ioredis';
import type { ProductCacheOptions } from './product-cache';

export const REDIS = Symbol('REDIS');
export const PRODUCT_CACHE_OPTIONS = Symbol('PRODUCT_CACHE_OPTIONS');

// Sem `CATALOG_REDIS_URL` o cache fica desligado (`null`): toda leitura vai ao
// banco. É o caso dos testes que não precisam de Redis. Com a URL, a conexão
// abre na subida, e um Redis fora do ar só faz o cache falhar rápido.
//
// Falha rápida: sem fila offline e sem retentativa por comando, o comando
// responde erro na hora em vez de segurar a requisição. A reconexão em segundo
// plano continua (retryStrategy padrão).
export const redisProvider: Provider = {
  provide: REDIS,
  useFactory: (): Redis | null => {
    const logger = new Logger('Redis');
    const url = process.env.CATALOG_REDIS_URL;
    if (!url) {
      logger.warn('CATALOG_REDIS_URL not set: product cache disabled');
      return null;
    }
    const redis = new Redis(url, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      commandTimeout: 200,
    });
    let lastError = '';
    redis.on('error', (error: Error) => {
      // A cada tentativa de reconexão o mesmo erro se repete; loga só a mudança.
      if (error.message !== lastError) {
        lastError = error.message;
        logger.warn(`Redis unavailable: ${error.message}`);
      }
    });
    redis.on('ready', () => {
      lastError = '';
    });
    return redis;
  },
};

export const productCacheOptionsProvider: Provider = {
  provide: PRODUCT_CACHE_OPTIONS,
  useFactory: (): ProductCacheOptions => ({
    ttlSeconds: Number(process.env.CATALOG_CACHE_TTL_SECONDS ?? 300),
    jitterRatio: 0.2,
    notFoundTtlSeconds: Number(
      process.env.CATALOG_CACHE_NOT_FOUND_TTL_SECONDS ?? 30,
    ),
    random: Math.random,
  }),
};

// Fecha a conexão no shutdown, para o processo (e os testes) terminarem limpos.
@Injectable()
export class RedisShutdown implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis | null) {}

  onApplicationShutdown() {
    this.redis?.disconnect();
  }
}
