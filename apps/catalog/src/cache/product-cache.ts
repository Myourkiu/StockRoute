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

// Cache-aside da leitura pública do produto. Sem Redis configurado, é um cache
// sempre vazio. Falha segura: qualquer erro do Redis é logado e tratado como
// miss (leitura) ou ignorado (escrita), e a operação segue pelo banco, que é a
// fonte da verdade.
@Injectable()
export class ProductCache {
  private readonly logger = new Logger(ProductCache.name);
  // Ids cuja invalidação falhou (Redis fora no momento da escrita). A chave
  // pode guardar um valor velho, como um produto já desativado, então este
  // processo não a lê até conseguir apagá-la ou sobrescrevê-la. Fica em
  // memória: outro processo ou um reinício só contam com o TTL. A versão
  // durável disso é registrar a invalidação junto da escrita (outbox).
  private readonly pendingInvalidations = new Set<string>();

  constructor(
    @Inject(REDIS) private readonly redis: Redis | null,
    @Inject(PRODUCT_CACHE_OPTIONS)
    private readonly options: ProductCacheOptions,
  ) {}

  async get(id: string): Promise<CacheRead> {
    if (!this.redis) {
      return { kind: 'miss' };
    }
    if (this.pendingInvalidations.has(id)) {
      await this.invalidate(id);
      return { kind: 'miss' };
    }
    let value: string | null;
    try {
      value = await this.redis.get(key(id));
    } catch (error) {
      this.warn('get', error);
      return { kind: 'miss' };
    }
    if (value === null) {
      return { kind: 'miss' };
    }
    if (value === NOT_FOUND) {
      return { kind: 'notFound' };
    }
    return this.decode(id, value);
  }

  async setProduct(product: ProductView): Promise<void> {
    const written = await this.safely('set', (redis) =>
      redis.set(
        key(product.id),
        JSON.stringify(product),
        'EX',
        this.jitteredTtl(),
      ),
    );
    // Sobrescrever com o valor atual também resolve uma invalidação pendente.
    if (written) {
      this.pendingInvalidations.delete(product.id);
    }
  }

  // Cache negativo: um id inexistente também vai para o cache, com TTL curto,
  // para que repetir a consulta não chegue ao banco (penetração de cache).
  async setNotFound(id: string): Promise<void> {
    const written = await this.safely('set', (redis) =>
      redis.set(key(id), NOT_FOUND, 'EX', this.options.notFoundTtlSeconds),
    );
    if (written) {
      this.pendingInvalidations.delete(id);
    }
  }

  async invalidate(id: string): Promise<void> {
    const deleted = await this.safely('del', (redis) => redis.del(key(id)));
    if (deleted) {
      this.pendingInvalidations.delete(id);
    } else if (this.redis) {
      this.pendingInvalidations.add(id);
    }
  }

  // Valor corrompido ou de outro formato vira miss: o banco responde e a
  // próxima gravação sobrescreve a chave.
  private decode(id: string, value: string): CacheRead {
    try {
      const product: unknown = JSON.parse(value);
      if (isProductView(product, id)) {
        return { kind: 'hit', product };
      }
    } catch {
      // JSON inválido: cai no aviso abaixo, como um formato inesperado.
    }
    this.logger.warn(`Invalid cached value for product ${id}, ignoring it`);
    return { kind: 'miss' };
  }

  // Jitter: chaves gravadas juntas não expiram juntas, o que evita uma
  // avalanche de misses no mesmo instante (stampede).
  private jitteredTtl(): number {
    const { ttlSeconds, jitterRatio, random } = this.options;
    const factor = 1 - jitterRatio + 2 * jitterRatio * random();
    return Math.round(ttlSeconds * factor);
  }

  // Devolve se o comando chegou ao Redis com sucesso.
  private async safely(
    operation: string,
    command: (redis: Redis) => Promise<unknown>,
  ): Promise<boolean> {
    if (!this.redis) {
      return false;
    }
    try {
      await command(this.redis);
      return true;
    } catch (error) {
      this.warn(operation, error);
      return false;
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

// Checagem mínima do formato: os campos que a leitura usa e o id pedido.
function isProductView(value: unknown, id: string): value is ProductView {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const product = value as Partial<ProductView>;
  return (
    product.id === id &&
    typeof product.supplierId === 'string' &&
    typeof product.name === 'string' &&
    typeof product.active === 'boolean' &&
    Array.isArray(product.variants)
  );
}
