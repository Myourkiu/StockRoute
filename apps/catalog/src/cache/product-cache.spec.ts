import { Logger } from '@nestjs/common';
import type { ProductView } from '@stockroute/contracts';
import type Redis from 'ioredis';
import { ProductCache, type ProductCacheOptions } from './product-cache';

const ID = '33333333-3333-4333-8333-333333333333';
const KEY = `catalog:product:v1:${ID}`;

const product: ProductView = {
  id: ID,
  supplierId: '11111111-1111-4111-8111-111111111111',
  name: 'Camiseta',
  description: 'Algodão',
  category: 'vestuario',
  tags: [],
  active: true,
  createdAt: '2026-10-30T12:00:00.000Z',
  updatedAt: '2026-10-30T12:00:00.000Z',
  variants: [],
};

function mockRedis() {
  return {
    get: jest.fn<Promise<string | null>, [string]>(),
    set: jest.fn<Promise<'OK'>, [string, string, 'EX', number]>(),
    del: jest.fn<Promise<number>, [string]>(),
  };
}

// Cliente de cache do produto (T08): chave versionada, TTL com jitter, cache
// negativo e falha segura (erro do Redis vira miss, nunca exceção).
describe('ProductCache', () => {
  let redis: ReturnType<typeof mockRedis>;

  function cache(random = 0.5) {
    const options: ProductCacheOptions = {
      ttlSeconds: 300,
      jitterRatio: 0.2,
      notFoundTtlSeconds: 30,
      random: () => random,
    };
    return new ProductCache(redis as unknown as Redis, options);
  }

  beforeAll(() => {
    // Os erros do Redis são logados como aviso; aqui só poluiriam a saída.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  beforeEach(() => {
    redis = mockRedis();
  });

  it.each([
    [0, 240],
    [0.5, 300],
    [1, 360],
  ])(
    'setProduct com aleatório %d grava com TTL de %d s',
    async (random, ttl) => {
      await cache(random).setProduct(product);

      expect(redis.set).toHaveBeenCalledWith(
        KEY,
        JSON.stringify(product),
        'EX',
        ttl,
      );
    },
  );

  it('setNotFound grava o marcador NF com TTL de 30 s', async () => {
    await cache().setNotFound(ID);

    expect(redis.set).toHaveBeenCalledWith(KEY, 'NF', 'EX', 30);
  });

  it('get de JSON → hit com o produto', async () => {
    redis.get.mockResolvedValue(JSON.stringify(product));

    await expect(cache().get(ID)).resolves.toEqual({ kind: 'hit', product });
  });

  it('get do marcador NF → notFound', async () => {
    redis.get.mockResolvedValue('NF');

    await expect(cache().get(ID)).resolves.toEqual({ kind: 'notFound' });
  });

  it('get de chave ausente → miss', async () => {
    redis.get.mockResolvedValue(null);

    await expect(cache().get(ID)).resolves.toEqual({ kind: 'miss' });
  });

  it('a chave é a versionada (v1), então uma entrada de outro formato não é lida', async () => {
    redis.get.mockResolvedValue(null);

    await cache().get(ID);

    expect(redis.get).toHaveBeenCalledWith(KEY);
  });

  it('invalidate apaga a chave do produto', async () => {
    await cache().invalidate(ID);

    expect(redis.del).toHaveBeenCalledWith(KEY);
  });

  it('erro ou timeout do Redis no get → miss, sem exceção', async () => {
    redis.get.mockRejectedValue(new Error('Command timed out'));

    await expect(cache().get(ID)).resolves.toEqual({ kind: 'miss' });
  });

  it('erro do Redis no set ou no invalidate é engolido', async () => {
    redis.set.mockRejectedValue(new Error('Connection is closed.'));
    redis.del.mockRejectedValue(new Error('Connection is closed.'));

    await expect(cache().setProduct(product)).resolves.toBeUndefined();
    await expect(cache().setNotFound(ID)).resolves.toBeUndefined();
    await expect(cache().invalidate(ID)).resolves.toBeUndefined();
  });
});
