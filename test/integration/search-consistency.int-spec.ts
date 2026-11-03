import type { INestApplication } from '@nestjs/common';
import {
  type ClientProxy,
  ClientProxyFactory,
  Transport,
} from '@nestjs/microservices';
import {
  CATALOG_PATTERNS,
  type Actor,
  type ProductSearchPage,
  type ProductView,
  type SearchProductsData,
} from '@stockroute/contracts';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import { firstValueFrom } from 'rxjs';
import type { StartedTestContainer } from 'testcontainers';
import { startCatalog } from '../../apps/catalog/src/bootstrap';
import { INDEXER_QUEUE } from '../../apps/catalog/src/events/rabbitmq.provider';
import { PrismaService } from '../../apps/catalog/src/prisma/prisma.service';
import { Reindexer } from '../../apps/catalog/src/search/reindexer';
import { SUPPLIER_ALFA } from '../fixtures/suppliers';
import { seedActiveProducts } from './catalog-seed';
import { pause, unpause } from './docker';
import {
  elasticsearchUrl,
  startElasticsearch,
} from './elasticsearch-container';
import { freePort } from './network';
import { connectionUrl, startPostgres } from './postgres-container';
import { migrateDeploy } from './prisma-migrate';
import { queueStats, startRabbitMQ } from './rabbitmq-container';
import { within } from './wait';

const supplier: Actor = { role: 'supplier', supplierId: SUPPLIER_ALFA };
const retailer: Actor = { role: 'retailer' };

// Consistência entre banco e índice (fatia 4, T11): o evento perdido deixa o
// índice para trás, e a reindexação sempre o traz de volta; durante ela, a
// busca continua respondendo com o índice anterior (CA23–CA25).
describe('consistência entre banco e índice (integração)', () => {
  let postgres: StartedPostgreSqlContainer;
  let rabbit: StartedRabbitMQContainer;
  let elastic: StartedTestContainer;
  let app: INestApplication;
  let client: ClientProxy;
  let sequence = 0;

  function send<T>(pattern: { cmd: string }, actor: Actor, data: unknown) {
    return firstValueFrom(client.send<T>(pattern, { actor, data }));
  }

  function create(name: string) {
    sequence += 1;
    return send<ProductView>(CATALOG_PATTERNS.create, supplier, {
      name,
      description: 'Produto da consistência',
      category: 'consistencia',
      tags: [],
      variants: [
        {
          sku: `CONS-${sequence}`,
          attributes: {},
          wholesalePriceCents: 1990,
          minQuantity: 1,
          initialStock: 1,
        },
      ],
    });
  }

  function search(filters: SearchProductsData) {
    return send<ProductSearchPage>(CATALOG_PATTERNS.search, retailer, filters);
  }

  async function searchIds(filters: SearchProductsData) {
    return (await search(filters)).items.map((item) => item.id);
  }

  beforeAll(async () => {
    [postgres, rabbit, elastic] = await Promise.all([
      startPostgres(),
      startRabbitMQ(),
      startElasticsearch(),
    ]);
    const url = connectionUrl(postgres, 'catalog_svc', 'catalog');
    await migrateDeploy('catalog', url);
    process.env.CATALOG_DATABASE_URL = url;
    process.env.CATALOG_RABBITMQ_URL = rabbit.getAmqpUrl();
    process.env.CATALOG_ELASTICSEARCH_URL = elasticsearchUrl(elastic);
    const tcpPort = await freePort();
    app = await startCatalog({
      tcpPort,
      httpPort: await freePort(),
      logger: false,
    });
    client = ClientProxyFactory.create({
      transport: Transport.TCP,
      options: { host: '127.0.0.1', port: tcpPort },
    });
    // O consumidor conecta em segundo plano; esperar aqui mantém o import
    // dinâmico do amqplib dentro do hook (o Jest recusa imports entre testes).
    await within(30_000, async () => {
      const { consumers } = await queueStats(rabbit, INDEXER_QUEUE);
      return consumers > 0;
    });
  }, 180_000);

  afterAll(async () => {
    await client?.close();
    await app?.close();
    delete process.env.CATALOG_RABBITMQ_URL;
    delete process.env.CATALOG_ELASTICSEARCH_URL;
    await Promise.all([postgres?.stop(), rabbit?.stop(), elastic?.stop()]);
  });

  it('RabbitMQ travado: a escrita é confirmada, e a reindexação traz o produto para a busca (CA23)', async () => {
    await pause(rabbit);
    try {
      const started = Date.now();
      const product = await create('Poncho de lã');
      expect(Date.now() - started).toBeLessThan(1000);
      await expect(
        send(CATALOG_PATTERNS.get, retailer, { id: product.id }),
      ).resolves.toMatchObject({ id: product.id });

      await app.get(Reindexer).run();

      expect(await searchIds({ q: 'poncho' })).toContain(product.id);
    } finally {
      await unpause(rabbit);
    }
  });

  it('produto alterado sem evento (evento perdido): a busca mostra o dado velho até a reindexação (CA24)', async () => {
    const product = await create('Gorro listrado');
    await within(5000, async () =>
      (await searchIds({ q: 'gorro' })).includes(product.id),
    );

    await app
      .get(PrismaService)
      .product.update({
        where: { id: product.id },
        data: { name: 'Touca lisa' },
      });

    expect(await searchIds({ q: 'gorro' })).toContain(product.id);
    expect(await searchIds({ q: 'touca' })).not.toContain(product.id);

    await app.get(Reindexer).run();

    expect(await searchIds({ q: 'touca' })).toContain(product.id);
    expect(await searchIds({ q: 'gorro' })).not.toContain(product.id);
  });

  it('busca em laço durante a reindexação de 1.000 produtos: nenhuma resposta com erro nem vazia (CA25)', async () => {
    await seedActiveProducts(app.get(PrismaService), 1000, 'CONS-BULK');
    await app.get(Reindexer).run();

    let finished = false;
    const reindex = app
      .get(Reindexer)
      .run()
      .finally(() => {
        finished = true;
      });
    const sizes: number[] = [];
    while (!finished) {
      const page = await search({ limit: 50 });
      sizes.push(page.items.length);
    }
    await reindex;

    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.every((size) => size === 50)).toBe(true);
  });
});
