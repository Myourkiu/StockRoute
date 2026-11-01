import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedRedisContainer } from '@testcontainers/redis';
import type Redis from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types';
import { ProductCache } from '../../apps/catalog/src/cache/product-cache';
import { REDIS } from '../../apps/catalog/src/cache/redis.provider';
import { CatalogModule } from '../../apps/catalog/src/catalog.module';
import { ProductNotFoundError } from '../../apps/catalog/src/products/product.errors';
import { ProductsRepository } from '../../apps/catalog/src/products/products.repository';
import { ProductsService } from '../../apps/catalog/src/products/products.service';
import type { Actor, ProductView } from '@stockroute/contracts';
import { SUPPLIER_ALFA } from '../fixtures/suppliers';
import { connectionUrl, startPostgres } from './postgres-container';
import { migrateDeploy } from './prisma-migrate';
import { pause, startRedis, unpause } from './redis-container';

const supplier: Actor = { role: 'supplier', supplierId: SUPPLIER_ALFA };
const retailer: Actor = { role: 'retailer' };
const NOT_FOUND_TTL_SECONDS = 2;

// Cache-aside com Redis e Postgres reais (T10): o cache responde com o banco
// travado, a escrita invalida, o "não existe" expira, e um Redis travado não
// derruba nada (CA11–CA15, CA22).
describe('cache do produto com Redis e Postgres (integração)', () => {
  let postgres: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let app: INestApplication<App>;
  let service: ProductsService;
  let redis: Redis;
  let skuSeq = 0;

  function create(): Promise<ProductView> {
    skuSeq += 1;
    return service.create(supplier, {
      name: 'Camiseta',
      description: 'Algodão',
      category: 'vestuario',
      tags: [],
      variants: [
        {
          sku: `CACHE-${skuSeq}`,
          attributes: {},
          wholesalePriceCents: 1990,
          minQuantity: 6,
          initialStock: 10,
        },
      ],
    });
  }

  async function timed<T>(operation: () => Promise<T>) {
    const started = Date.now();
    const result = await operation();
    return { result, elapsed: Date.now() - started };
  }

  beforeAll(async () => {
    [postgres, redisContainer] = await Promise.all([
      startPostgres(),
      startRedis(),
    ]);
    const url = connectionUrl(postgres, 'catalog_svc', 'catalog');
    await migrateDeploy('catalog', url);
    process.env.CATALOG_DATABASE_URL = url;
    process.env.CATALOG_REDIS_URL = redisContainer.getConnectionUrl();
    process.env.CATALOG_CACHE_NOT_FOUND_TTL_SECONDS = String(
      NOT_FOUND_TTL_SECONDS,
    );
    // O Redis travado gera avisos de propósito; aqui só poluiriam a saída.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    const moduleRef = await Test.createTestingModule({
      imports: [CatalogModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    service = app.get(ProductsService);
    redis = app.get<Redis>(REDIS);
    // Sem fila offline, comandos antes da conexão ficar pronta falham.
    if (redis.status !== 'ready') {
      await new Promise((resolve) => redis.once('ready', resolve));
    }
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([postgres?.stop(), redisContainer?.stop()]);
    for (const name of [
      'CATALOG_DATABASE_URL',
      'CATALOG_REDIS_URL',
      'CATALOG_CACHE_NOT_FOUND_TTL_SECONDS',
    ]) {
      delete process.env[name];
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  it('com o produto em cache, o banco travado não impede a leitura (CA11)', async () => {
    const product = await create();
    await service.get(retailer, { id: product.id });

    await pause(postgres);
    try {
      await expect(service.get(retailer, { id: product.id })).resolves.toEqual(
        product,
      );
    } finally {
      await unpause(postgres);
    }
  });

  it('editar o produto em cache faz a próxima leitura já trazer a mudança (CA12)', async () => {
    const product = await create();
    await service.get(retailer, { id: product.id });

    await service.update(supplier, {
      id: product.id,
      changes: { name: 'Camiseta premium' },
    });

    await expect(
      service.get(retailer, { id: product.id }),
    ).resolves.toMatchObject({ name: 'Camiseta premium' });
  });

  it('o "não existe" responde do cache com o banco travado e expira no prazo curto (CA13)', async () => {
    const id = '00000000-0000-4000-8000-0000000000aa';
    await expect(service.get(retailer, { id })).rejects.toBeInstanceOf(
      ProductNotFoundError,
    );

    await pause(postgres);
    try {
      await expect(service.get(retailer, { id })).rejects.toBeInstanceOf(
        ProductNotFoundError,
      );
    } finally {
      await unpause(postgres);
    }
    const findById = jest.spyOn(app.get(ProductsRepository), 'findById');
    await new Promise((resolve) =>
      setTimeout(resolve, NOT_FOUND_TTL_SECONDS * 1000 + 300),
    );
    await expect(service.get(retailer, { id })).rejects.toBeInstanceOf(
      ProductNotFoundError,
    );

    expect(findById).toHaveBeenCalledWith(id);
  });

  it('50 produtos gravados juntos não expiram todos no mesmo instante (CA14)', async () => {
    const cache = app.get(ProductCache);
    const ids = Array.from(
      { length: 50 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    const product = await create();

    await Promise.all(ids.map((id) => cache.setProduct({ ...product, id })));
    const ttls = await Promise.all(
      ids.map((id) => redis.ttl(`catalog:product:v1:${id}`)),
    );

    expect(new Set(ttls).size).toBeGreaterThan(1);
    for (const ttl of ttls) {
      expect(ttl).toBeGreaterThanOrEqual(239);
      expect(ttl).toBeLessThanOrEqual(360);
    }
  });

  it('com o Redis travado, ler, criar e editar funcionam pelo banco em menos de 1 s (CA15)', async () => {
    const product = await create();

    await pause(redisContainer);
    try {
      const read = await timed(() => service.get(retailer, { id: product.id }));
      const created = await timed(() => create());
      const updated = await timed(() =>
        service.update(supplier, {
          id: product.id,
          changes: { name: 'Sem cache' },
        }),
      );

      expect(read.result.id).toBe(product.id);
      expect(updated.result.name).toBe('Sem cache');
      expect(created.result.active).toBe(true);
      for (const { elapsed } of [read, created, updated]) {
        expect(elapsed).toBeLessThan(1000);
      }
    } finally {
      await unpause(redisContainer);
    }
  });

  it('com o Redis travado, o readiness do catalog continua 200 (CA22, parte do cache)', async () => {
    await pause(redisContainer);
    try {
      const response = await request(app.getHttpServer()).get('/health/ready');

      expect(response.status).toBe(200);
    } finally {
      await unpause(redisContainer);
    }
  });
});
