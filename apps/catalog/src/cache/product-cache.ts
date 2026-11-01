import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ProductView } from '@stockroute/contracts';
import type Redis from 'ioredis';
import { PRODUCT_CACHE_OPTIONS, REDIS } from './redis.provider';

export interface ProductCacheOptions {
  ttlSeconds: number;
  // Fração do TTL que varia para mais ou para menos (0,2 → 240 a 360 s).
  jitterRatio: number;
  notFoundTtlSeconds: number;
  random: () => number;
}

export type CacheRead =
  | { kind: 'hit'; product: ProductView }
  | { kind: 'notFound' }
  | { kind: 'miss' };

// Muda quando o formato do valor em cache muda: as chaves antigas deixam de ser
// lidas e expiram sozinhas, sem servir dado no formato velho.
const KEY_VERSION = 'v1';
const NOT_FOUND = 'NF';

// Cache-aside da leitura pública do produto. Falha segura: qualquer erro do
// Redis é logado e tratado como miss (leitura) ou ignorado (escrita), e a
// operação segue pelo banco, que é a fonte da verdade.
@Injectable()
export class ProductCache {
  private readonly logger = new Logger(ProductCache.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PRODUCT_CACHE_OPTIONS)
    private readonly options: ProductCacheOptions,
  ) {}

  async get(id: string): Promise<CacheRead> {
    try {
      const value = await this.redis.get(key(id));
      if (value === null) {
        return { kind: 'miss' };
      }
      if (value === NOT_FOUND) {
        return { kind: 'notFound' };
      }
      return { kind: 'hit', product: JSON.parse(value) as ProductView };
    } catch (error) {
      this.warn('get', error);
      return { kind: 'miss' };
    }
  }

  async setProduct(product: ProductView): Promise<void> {
    await this.safely('set', () =>
      this.redis.set(
        key(product.id),
        JSON.stringify(product),
        'EX',
        this.jitteredTtl(),
      ),
    );
  }

  // Cache negativo: um id inexistente também vai para o cache, com TTL curto,
  // para que repetir a consulta não chegue ao banco (penetração de cache).
  async setNotFound(id: string): Promise<void> {
    await this.safely('set', () =>
      this.redis.set(key(id), NOT_FOUND, 'EX', this.options.notFoundTtlSeconds),
    );
  }

  async invalidate(id: string): Promise<void> {
    await this.safely('del', () => this.redis.del(key(id)));
  }

  // Jitter: chaves gravadas juntas não expiram juntas, o que evita uma
  // avalanche de misses no mesmo instante (stampede).
  private jitteredTtl(): number {
    const { ttlSeconds, jitterRatio, random } = this.options;
    const factor = 1 - jitterRatio + 2 * jitterRatio * random();
    return Math.round(ttlSeconds * factor);
  }

  private async safely(operation: string, command: () => Promise<unknown>) {
    try {
      await command();
    } catch (error) {
      this.warn(operation, error);
    }
  }

  private warn(operation: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Redis ${operation} failed, falling back: ${message}`);
  }
}

function key(id: string): string {
  return `catalog:product:${KEY_VERSION}:${id}`;
}
