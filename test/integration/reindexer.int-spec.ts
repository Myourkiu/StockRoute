import { Client } from '@elastic/elasticsearch';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { randomUUID } from 'node:crypto';
import type { StartedTestContainer } from 'testcontainers';
import { PrismaService } from '../../apps/catalog/src/prisma/prisma.service';
import { ProductsRepository } from '../../apps/catalog/src/products/products.repository';
import { elasticsearchProvider } from '../../apps/catalog/src/search/elasticsearch.provider';
import { ProductIndex } from '../../apps/catalog/src/search/product-index';
import { Reindexer } from '../../apps/catalog/src/search/reindexer';
import { SUPPLIER_ALFA } from '../fixtures/suppliers';
import {
  elasticsearchUrl,
  startElasticsearch,
} from './elasticsearch-container';
import { connectionUrl, startPostgres } from './postgres-container';
import { migrateDeploy } from './prisma-migrate';

// Reindexação com Postgres e Elasticsearch reais (fatia 4, T09): o índice
// passa a ter exatamente os produtos ativos do banco, com os dados atuais, e
// o alias troca para o índice novo (CA24).
describe('Reindexer (Postgres e Elasticsearch reais)', () => {
  let postgres: StartedPostgreSqlContainer;
  let elastic: StartedTestContainer;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let repository: ProductsRepository;
  let index: ProductIndex;
  let admin: Client;
  let skuSeq = 0;

  function reindexer() {
    return moduleRef.get(Reindexer);
  }

  async function create(name: string) {
    skuSeq += 1;
    return repository.create({
      supplierId: SUPPLIER_ALFA,
      name,
      description: 'Produto da reindexação',
      category: 'vestuario',
      tags: [],
      variants: [
        {
          sku: `REINDEX-${skuSeq}`,
          attributes: {},
          wholesalePriceCents: 1990,
          minQuantity: 1,
          initialStock: 1,
        },
      ],
    });
  }

  // Muitos produtos de uma vez, direto pelo Prisma: criar um a um levaria
  // segundos sem testar nada a mais.
  async function createMany(count: number) {
    const rows = Array.from({ length: count }, (_, n) => ({
      id: randomUUID(),
      sku: `BULK-${n + 1}`,
    }));
    await prisma.product.createMany({
      data: rows.map(({ id }, n) => ({
        id,
        supplierId: SUPPLIER_ALFA,
        name: `Produto em lote ${n + 1}`,
        description: '',
        category: 'lote',
        tags: [],
      })),
    });
    await prisma.variant.createMany({
      data: rows.map(({ id, sku }) => ({
        productId: id,
        sku,
        attributes: {},
        wholesalePriceCents: 1000,
        minQuantity: 1,
      })),
    });
    await prisma.stock.createMany({
      data: rows.map(({ sku }) => ({ sku, available: 1 })),
    });
    return rows.map(({ id }) => id);
  }

  async function productIndices(): Promise<string[]> {
    const indices = await admin.indices.get({
      index: 'products_*',
      allow_no_indices: true,
      ignore_unavailable: true,
    });
    return Object.keys(indices);
  }

  async function indexedIds(): Promise<string[]> {
    const response = await admin.search<{ id: string }>({
      index: 'products',
      size: 2000,
      _source: ['id'],
    });
    return response.hits.hits.map((hit) => hit._source!.id).sort();
  }

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    [postgres, elastic] = await Promise.all([
      startPostgres(),
      startElasticsearch(),
    ]);
    const url = connectionUrl(postgres, 'catalog_svc', 'catalog');
    await migrateDeploy('catalog', url);
    process.env.CATALOG_DATABASE_URL = url;
    process.env.CATALOG_ELASTICSEARCH_URL = elasticsearchUrl(elastic);
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        ProductsRepository,
        elasticsearchProvider,
        ProductIndex,
        Reindexer,
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    repository = moduleRef.get(ProductsRepository);
    index = moduleRef.get(ProductIndex);
    admin = new Client({ node: elasticsearchUrl(elastic) });
  }, 180_000);

  afterAll(async () => {
    await admin?.close();
    await moduleRef?.close();
    delete process.env.CATALOG_ELASTICSEARCH_URL;
    await Promise.all([postgres?.stop(), elastic?.stop()]);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE stock, variants, products CASCADE',
    );
    for (const name of await productIndices()) {
      await admin.indices.delete({ index: name });
    }
  });

  it('sem índice nem alias, 3 ativos e 1 inativo → o índice fica com os 3, e o alias nasce (CA24)', async () => {
    const active = await Promise.all([
      create('Camiseta'),
      create('Bermuda'),
      create('Boné'),
    ]);
    const inactive = await create('Meia');
    await repository.setActive(inactive.id, false);

    await expect(reindexer().run()).resolves.toBe(3);

    expect(await indexedIds()).toEqual(active.map((p) => p.id).sort());
    await expect(admin.indices.existsAlias({ name: 'products' })).resolves.toBe(
      true,
    );
  });

  it('índice divergente (produto apagado, nome velho, produto faltando) → igual ao banco (CA24)', async () => {
    const renamed = await create('Nome antigo');
    const missing = await create('Nunca indexado');
    await index.upsert(renamed);
    await index.upsert({ ...renamed, id: randomUUID(), name: 'Fantasma' });
    await repository.update(renamed.id, { name: 'Nome novo' });

    await expect(reindexer().run()).resolves.toBe(2);

    expect(await indexedIds()).toEqual([renamed.id, missing.id].sort());
    const response = await admin.search<{ name: string }>({
      index: 'products',
      query: { term: { id: renamed.id } },
    });
    expect(response.hits.hits[0]._source?.name).toBe('Nome novo');
  });

  it('1.201 produtos → todos no índice, sem repetir', async () => {
    const ids = await createMany(1201);

    await expect(reindexer().run()).resolves.toBe(1201);

    const { count } = await admin.count({ index: 'products' });
    expect(count).toBe(1201);
    expect(await indexedIds()).toEqual(ids.sort());
  });

  it('segunda execução → o alias aponta para o índice novo, e o antigo é apagado', async () => {
    await create('Camiseta');
    await reindexer().run();
    const [first] = await productIndices();

    await reindexer().run();

    const indices = await productIndices();
    expect(indices).toHaveLength(1);
    expect(indices[0]).not.toBe(first);
    const alias = await admin.indices.getAlias({ name: 'products' });
    expect(Object.keys(alias)).toEqual(indices);
  });

  it('banco sem produto ativo → índice novo vazio, com o alias trocado', async () => {
    await create('Antigo');
    await reindexer().run();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE stock, variants, products CASCADE',
    );

    await expect(reindexer().run()).resolves.toBe(0);

    const { count } = await admin.count({ index: 'products' });
    expect(count).toBe(0);
    expect(await productIndices()).toHaveLength(1);
  });
});
