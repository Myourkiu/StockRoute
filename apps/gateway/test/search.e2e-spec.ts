import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { StartedTestContainer } from 'testcontainers';
import { pause, unpause } from '../../../test/integration/docker';
import {
  elasticsearchUrl,
  startElasticsearch,
} from '../../../test/integration/elasticsearch-container';
import { freePort } from '../../../test/integration/network';
import {
  connectionUrl,
  startPostgres,
} from '../../../test/integration/postgres-container';
import { migrateDeploy } from '../../../test/integration/prisma-migrate';
import {
  queueStats,
  startRabbitMQ,
} from '../../../test/integration/rabbitmq-container';
import { within } from '../../../test/integration/wait';
import { SUPPLIER_ALFA } from '../../../test/fixtures/suppliers';
import { startCatalog } from '../../catalog/src/bootstrap';
import { INDEXER_QUEUE } from '../../catalog/src/events/rabbitmq.provider';
import { GatewayModule } from '../src/gateway.module';

const SECRET = 'e2e-secret';
const INDEXING_DEADLINE_MS = 5000;

interface SearchBody {
  items: { id: string; minPriceCents: number; maxPriceCents: number }[];
  nextCursor: string | null;
}

// Busca de ponta a ponta (fatia 3, T08): gateway (HTTP) → catalog (TCP) →
// Elasticsearch, com a escrita indo ao índice pelo RabbitMQ. Todos reais.
describe('/products/search (e2e)', () => {
  const jwt = new JwtService({
    secret: SECRET,
    signOptions: { expiresIn: '1h' },
  });
  const supplier = `Bearer ${jwt.sign({ sub: SUPPLIER_ALFA, role: 'supplier', supplierId: SUPPLIER_ALFA })}`;
  const retailer = `Bearer ${jwt.sign({ sub: 'lojista-1', role: 'retailer' })}`;

  let postgres: StartedPostgreSqlContainer;
  let rabbit: StartedRabbitMQContainer;
  let elastic: StartedTestContainer;
  let catalog: INestApplication;
  let gateway: INestApplication<App>;
  let skuSeq = 0;

  function http() {
    return request(gateway.getHttpServer());
  }

  async function create(
    name: string,
    { category = 'vestuario', prices = [1990] } = {},
  ): Promise<string> {
    const response = await http()
      .post('/products')
      .set('Authorization', supplier)
      .send({
        name,
        description: 'Produto do e2e da busca',
        category,
        tags: [],
        variants: prices.map((price) => {
          skuSeq += 1;
          return {
            sku: `SEARCH-E2E-${skuSeq}`,
            attributes: {},
            wholesalePriceCents: price,
            minQuantity: 1,
            initialStock: 5,
          };
        }),
      });
    expect(response.status).toBe(201);
    return (response.body as { id: string }).id;
  }

  async function searchIds(query: Record<string, string>) {
    const response = await http()
      .get('/products/search')
      .query(query)
      .set('Authorization', retailer);
    expect(response.status).toBe(200);
    return (response.body as SearchBody).items.map((item) => item.id);
  }

  function indexed(query: Record<string, string>, ids: string[]) {
    return within(INDEXING_DEADLINE_MS, async () => {
      const found = await searchIds(query);
      return ids.every((id) => found.includes(id));
    });
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
    catalog = await startCatalog({
      tcpPort,
      httpPort: await freePort(),
      logger: false,
    });
    // O consumidor conecta em segundo plano; esperar aqui mantém o import
    // dinâmico do amqplib dentro do hook (o Jest recusa imports entre testes).
    await within(30_000, async () => {
      const { consumers } = await queueStats(rabbit, INDEXER_QUEUE);
      return consumers > 0;
    });

    process.env.CATALOG_TCP_HOST = '127.0.0.1';
    process.env.CATALOG_TCP_PORT = String(tcpPort);
    process.env.JWT_SECRET = SECRET;
    const gatewayRef = await Test.createTestingModule({
      imports: [GatewayModule],
    }).compile();
    gateway = gatewayRef.createNestApplication();
    await gateway.init();
  }, 180_000);

  afterAll(async () => {
    await gateway?.close();
    await catalog?.close();
    await Promise.all([postgres?.stop(), rabbit?.stop(), elastic?.stop()]);
    for (const name of [
      'CATALOG_DATABASE_URL',
      'CATALOG_RABBITMQ_URL',
      'CATALOG_ELASTICSEARCH_URL',
      'CATALOG_TCP_HOST',
      'CATALOG_TCP_PORT',
      'JWT_SECRET',
    ]) {
      delete process.env[name];
    }
  });

  it('sem token → 401; lojista e fornecedor → 200 (CA01, CA02)', async () => {
    const anonymous = await http().get('/products/search');
    const asRetailer = await http()
      .get('/products/search')
      .set('Authorization', retailer);
    const asSupplier = await http()
      .get('/products/search')
      .set('Authorization', supplier);

    expect(anonymous.status).toBe(401);
    expect(asRetailer.status).toBe(200);
    expect(asSupplier.status).toBe(200);
  });

  it('GET /products/search é a busca, e não o GET por id (que daria 404)', async () => {
    const response = await http()
      .get('/products/search')
      .set('Authorization', retailer);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('items');
    expect(response.body).toHaveProperty('nextCursor');
  });

  it('o fornecedor cria, e o lojista acha pela busca em até 5 s (CA16)', async () => {
    const id = await create('Sandália de couro');

    await indexed({ q: 'sandália' }, [id]);
  });

  it('filtros de categoria e preço pelo HTTP trazem só os produtos esperados (CA17, CA18)', async () => {
    const shoe = await create('Tênis de corrida', {
      category: 'calcados-e2e',
      prices: [1000, 5000],
    });
    const coat = await create('Casaco de lã', {
      category: 'vestuario-e2e',
      prices: [7000],
    });
    await indexed({}, [shoe, coat]);

    expect(await searchIds({ category: 'calcados-e2e' })).toEqual([shoe]);
    const inRange = await searchIds({
      minPriceCents: '4000',
      maxPriceCents: '6000',
    });
    expect(inRange).toContain(shoe);
    expect(inRange).not.toContain(coat);
    const inverted = await http()
      .get('/products/search')
      .query({ minPriceCents: '6000', maxPriceCents: '4000' })
      .set('Authorization', retailer);
    expect(inverted.status).toBe(400);
  });

  it('percorrer as páginas pelo nextCursor traz cada produto uma vez; cursor adulterado → 400 (CA19)', async () => {
    const category = 'paginacao-e2e';
    const ids = [];
    for (let n = 1; n <= 5; n += 1) {
      ids.push(await create(`Meia modelo ${n}`, { category }));
    }
    await indexed({ category }, ids);

    const pages: string[][] = [];
    let cursor: string | null = null;
    do {
      const response = await http()
        .get('/products/search')
        .query({ category, limit: '2', ...(cursor && { cursor }) })
        .set('Authorization', retailer);
      expect(response.status).toBe(200);
      const body = response.body as SearchBody;
      pages.push(body.items.map((item) => item.id));
      cursor = body.nextCursor;
    } while (cursor);

    expect(pages.map((page) => page.length)).toEqual([2, 2, 1]);
    expect(new Set(pages.flat())).toEqual(new Set(ids));
    for (const tampered of ['não-é-cursor!', 'eyJ2IjoyfQ']) {
      const response = await http()
        .get('/products/search')
        .query({ category, cursor: tampered })
        .set('Authorization', retailer);
      expect(response.status).toBe(400);
    }
  });

  it('ES travado → busca 503; o GET por id e a criação continuam funcionando (CA21)', async () => {
    const id = await create('Bolsa de praia');
    await pause(elastic);
    try {
      const search = await http()
        .get('/products/search')
        .set('Authorization', retailer);
      const get = await http()
        .get(`/products/${id}`)
        .set('Authorization', retailer);
      const created = await http()
        .post('/products')
        .set('Authorization', supplier)
        .send({
          name: 'Óculos de sol',
          description: '',
          category: 'acessorios',
          tags: [],
          variants: [
            {
              sku: `SEARCH-E2E-ES-DOWN`,
              attributes: {},
              wholesalePriceCents: 4500,
              minQuantity: 1,
              initialStock: 1,
            },
          ],
        });

      expect(search.status).toBe(503);
      expect(get.status).toBe(200);
      expect(created.status).toBe(201);
    } finally {
      await unpause(elastic);
    }
  });
});
