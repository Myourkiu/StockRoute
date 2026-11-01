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

// Porta padrão dentro da faixa do projeto (18000–18299 + Redis = 18379), e não
// a 6379, que outro projeto da máquina usa. Sem Redis nela, o cache só falha
// rápido e tudo segue pelo banco.
const DEFAULT_REDIS_URL = 'redis://127.0.0.1:18379';

// Falha rápida: sem fila offline e sem retentativa por comando, um Redis fora
// do ar responde erro na hora em vez de segurar a requisição. A reconexão em
// segundo plano continua (retryStrategy padrão).
export const redisProvider: Provider = {
  provide: REDIS,
  useFactory: () => {
    const logger = new Logger('Redis');
    const redis = new Redis(
      process.env.CATALOG_REDIS_URL ?? DEFAULT_REDIS_URL,
      {
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
        commandTimeout: 200,
      },
    );
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
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  onApplicationShutdown() {
    this.redis.disconnect();
  }
}
