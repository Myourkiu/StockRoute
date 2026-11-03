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
import type { StartedTestContainer } from 'testcontainers';
import { firstValueFrom } from 'rxjs';
import { startCatalog } from '../../apps/catalog/src/bootstrap';
import { INDEXER_QUEUE } from '../../apps/catalog/src/events/rabbitmq.provider';
import { SUPPLIER_ALFA } from '../fixtures/suppliers';
import { pause, unpause } from './docker';
import {
  elasticsearchUrl,
  startElasticsearch,
} from './elasticsearch-container';
import { freePort } from './network';
import { connectionUrl, startPostgres } from './postgres-container';
import { migrateDeploy } from './prisma-migrate';
import { startRabbitMQ } from './rabbitmq-container';
import { within } from './wait';

const supplier: Actor = { role: 'supplier', supplierId: SUPPLIER_ALFA };
const retailer: Actor = { role: 'retailer' };
const INDEXING_DEADLINE_MS = 5000;

// Indexação ponta a ponta (fatia 3, T06): escrita no catalog → evento no
// RabbitMQ → consumidor → Elasticsearch, com os três reais e o catalog
// subindo como em produção. O prazo do CA16 é de 5 s depois da escrita.
describe('indexação da busca com RabbitMQ e Elasticsearch (integração)', () => {
  let postgres: StartedPostgreSqlContainer;
  let rabbit: StartedRabbitMQContainer;
  let elastic: StartedTestContainer;
  let app: INestApplication;
  let client: ClientProxy;
  let sequence = 0;

  function send<T>(pattern: { cmd: string }, actor: Actor, data: unknown) {
    return firstValueFrom(client.send<T>(pattern, { actor, data }));
  }

  function create(name: string, prices = [1990]) {
    sequence += 1;
    return send<ProductView>(CATALOG_PATTERNS.create, supplier, {
      name,
      description: 'Produto de teste',
      category: 'vestuario',
      tags: [],
      variants: prices.map((price, i) => ({
        sku: `IDX-${sequence}-${i}`,
        attributes: {},
        wholesalePriceCents: price,
        minQuantity: 1,
        initialStock: 10,
      })),
    });
  }

  async function searchIds(filters: SearchProductsData) {
    const page = await send<ProductSearchPage>(
      CATALOG_PATTERNS.search,
      retailer,
      filters,
    );
    return page.items.map((item) => item.id);
  }

  async function timed<T>(operation: () => Promise<T>) {
    const started = Date.now();
    const result = await operation();
    return { result, elapsed: Date.now() - started };
  }

  // Mensagens na fila do indexador, prontas ou entregues e sem ack.
  async function queueDepth(): Promise<number> {
    const { output } = await rabbit.exec([
      'rabbitmqctl',
      'list_queues',
      '--quiet',
      '--no-table-headers',
      'name',
      'messages',
    ]);
    const line = output
      .split('\n')
      .find((row) => row.trim().startsWith(INDEXER_QUEUE));
    return line ? Number(line.trim().split(/\s+/)[1]) : 0;
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
  }, 180_000);

  afterAll(async () => {
    await client?.close();
    await app?.close();
    delete process.env.CATALOG_RABBITMQ_URL;
    delete process.env.CATALOG_ELASTICSEARCH_URL;
    await Promise.all([postgres?.stop(), rabbit?.stop(), elastic?.stop()]);
  });

  it('produto criado aparece na busca pelo nome em até 5 s (CA16)', async () => {
    const product = await create('Jaqueta impermeável');

    await within(INDEXING_DEADLINE_MS, async () =>
      (await searchIds({ q: 'jaqueta' })).includes(product.id),
    );
  });

  it('nome editado: o termo novo acha e o antigo não, em até 5 s', async () => {
    const product = await create('Boné aba reta');
    await within(INDEXING_DEADLINE_MS, async () =>
      (await searchIds({ q: 'boné' })).includes(product.id),
    );

    await send(CATALOG_PATTERNS.update, supplier, {
      id: product.id,
      changes: { name: 'Chapéu de palha' },
    });

    await within(INDEXING_DEADLINE_MS, async () => {
      const [byNew, byOld] = await Promise.all([
        searchIds({ q: 'chapéu' }),
        searchIds({ q: 'boné' }),
      ]);
      return byNew.includes(product.id) && !byOld.includes(product.id);
    });
  });

  it('variante nova de R$ 90 coloca o produto na faixa de R$ 80 a R$ 100 (CA18)', async () => {
    const product = await create('Mochila escolar', [3000]);
    await within(INDEXING_DEADLINE_MS, async () =>
      (await searchIds({ q: 'mochila' })).includes(product.id),
    );

    await send(CATALOG_PATTERNS.addVariant, supplier, {
      id: product.id,
      variant: {
        sku: `IDX-${product.id}-9000`,
        attributes: {},
        wholesalePriceCents: 9000,
        minQuantity: 1,
        initialStock: 1,
      },
    });

    await within(INDEXING_DEADLINE_MS, async () =>
      (await searchIds({ minPriceCents: 8000, maxPriceCents: 10000 })).includes(
        product.id,
      ),
    );
  });

  it('desativado some da busca em até 5 s; reativado volta em até 5 s (CA08, CA09, CA16)', async () => {
    const product = await create('Cinto de couro');
    await within(INDEXING_DEADLINE_MS, async () =>
      (await searchIds({ q: 'cinto' })).includes(product.id),
    );

    await send(CATALOG_PATTERNS.deactivate, supplier, { id: product.id });
    await within(
      INDEXING_DEADLINE_MS,
      async () => !(await searchIds({ q: 'cinto' })).includes(product.id),
    );

    await send(CATALOG_PATTERNS.update, supplier, {
      id: product.id,
      changes: { active: true },
    });
    await within(INDEXING_DEADLINE_MS, async () =>
      (await searchIds({ q: 'cinto' })).includes(product.id),
    );
  });

  // Com requeue, a mensagem voltaria para a fila a cada timeout do índice e
  // ficaria nela em loop; com ack, a fila esvazia depois da primeira tentativa.
  // O teste não confere o índice depois: o pedido que deu timeout fica no
  // socket do ES pausado e pode ser executado quando ele volta.
  it('ES travado: a escrita responde em menos de 1 s, e a mensagem recebe ack sem voltar para a fila (D16)', async () => {
    await pause(elastic);
    try {
      const { elapsed } = await timed(() => create('Luva térmica'));
      expect(elapsed).toBeLessThan(1000);

      // Passado o timeout de 2 s do cliente do ES, o indexador já desistiu.
      await new Promise((resolve) => setTimeout(resolve, 3000));
      expect(await queueDepth()).toBe(0);
    } finally {
      await unpause(elastic);
    }
  });

  it('RabbitMQ travado: a escrita responde em menos de 1 s, e o produto está no banco (CA23)', async () => {
    await pause(rabbit);
    try {
      const { result: product, elapsed } = await timed(() =>
        create('Cachecol de lã'),
      );

      expect(elapsed).toBeLessThan(1000);
      await expect(
        send(CATALOG_PATTERNS.get, retailer, { id: product.id }),
      ).resolves.toMatchObject({ id: product.id, active: true });
    } finally {
      await unpause(rabbit);
    }
  });
});
