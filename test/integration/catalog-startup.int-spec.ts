import type { INestApplication } from '@nestjs/common';
import {
  type ClientProxy,
  ClientProxyFactory,
  Transport,
} from '@nestjs/microservices';
import { CATALOG_PATTERNS, type Actor } from '@stockroute/contracts';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { firstValueFrom } from 'rxjs';
import { startCatalog } from '../../apps/catalog/src/bootstrap';
import { SUPPLIER_ALFA } from '../fixtures/suppliers';
import { pause, unpause } from './docker';
import { blackHole, freePort } from './network';
import { connectionUrl, startPostgres } from './postgres-container';
import { migrateDeploy } from './prisma-migrate';

const supplier: Actor = { role: 'supplier', supplierId: SUPPLIER_ALFA };
const OPTIONAL_VARS = ['CATALOG_RABBITMQ_URL', 'CATALOG_ELASTICSEARCH_URL'];

// Subida do catalog com o broker e o índice fora ou travados (fatia 3, T05).
// Os dois são opcionais: o catalog sobe, fica pronto e atende a escrita e o
// GET; só a busca responde 503. O readiness depende só do banco (CA21, CA22).
describe('subida do catalog com dependências opcionais (integração)', () => {
  let postgres: StartedPostgreSqlContainer;
  let app: INestApplication | undefined;
  let client: ClientProxy | undefined;
  let httpPort: number;
  let skuSeq = 0;

  async function start() {
    const tcpPort = await freePort();
    httpPort = await freePort();
    const started = Date.now();
    app = await startCatalog({ tcpPort, httpPort, logger: false });
    client = ClientProxyFactory.create({
      transport: Transport.TCP,
      options: { host: '127.0.0.1', port: tcpPort },
    });
    return started;
  }

  async function readinessStatus(): Promise<number> {
    const response = await fetch(`http://127.0.0.1:${httpPort}/health/ready`);
    return response.status;
  }

  function send<T>(pattern: { cmd: string }, data: unknown): Promise<T> {
    return firstValueFrom(client!.send<T>(pattern, { actor: supplier, data }));
  }

  function create() {
    skuSeq += 1;
    return send<{ id: string }>(CATALOG_PATTERNS.create, {
      name: 'Camiseta',
      description: 'Algodão',
      category: 'vestuario',
      tags: [],
      variants: [
        {
          sku: `STARTUP-${skuSeq}`,
          attributes: {},
          wholesalePriceCents: 1990,
          minQuantity: 6,
          initialStock: 10,
        },
      ],
    });
  }

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = connectionUrl(postgres, 'catalog_svc', 'catalog');
    await migrateDeploy('catalog', url);
    process.env.CATALOG_DATABASE_URL = url;
  }, 120_000);

  afterEach(async () => {
    await client?.close();
    await app?.close();
    client = undefined;
    app = undefined;
    for (const name of OPTIONAL_VARS) {
      delete process.env[name];
    }
  });

  afterAll(async () => {
    await postgres?.stop();
  });

  it('broker e índice recusando conexão → pronto em menos de 5 s; escrita e GET funcionam; busca 503', async () => {
    process.env.CATALOG_RABBITMQ_URL = `amqp://127.0.0.1:${await freePort()}`;
    process.env.CATALOG_ELASTICSEARCH_URL = `http://127.0.0.1:${await freePort()}`;

    const started = await start();

    expect(await readinessStatus()).toBe(200);
    expect(Date.now() - started).toBeLessThan(5000);
    const created = await create();
    await expect(
      send(CATALOG_PATTERNS.get, { id: created.id }),
    ).resolves.toMatchObject({ id: created.id });
    await expect(send(CATALOG_PATTERNS.search, {})).rejects.toEqual({
      status: 503,
      message: 'Search unavailable',
    });
  });

  it('broker e índice travados (aceitam a conexão e não respondem) → pronto em menos de 5 s; criar responde em menos de 1 s', async () => {
    const rabbit = await blackHole();
    const elastic = await blackHole();
    process.env.CATALOG_RABBITMQ_URL = `amqp://127.0.0.1:${rabbit.port}`;
    process.env.CATALOG_ELASTICSEARCH_URL = `http://127.0.0.1:${elastic.port}`;
    try {
      const started = await start();

      expect(await readinessStatus()).toBe(200);
      expect(Date.now() - started).toBeLessThan(5000);
      const writeStarted = Date.now();
      await create();
      expect(Date.now() - writeStarted).toBeLessThan(1000);
    } finally {
      await client?.close();
      await app?.close();
      app = undefined;
      await rabbit.close();
      await elastic.close();
    }
  });

  it('sem as duas variáveis → sobe como antes, e a busca responde 503', async () => {
    await start();

    expect(await readinessStatus()).toBe(200);
    await expect(send(CATALOG_PATTERNS.search, {})).rejects.toEqual({
      status: 503,
      message: 'Search unavailable',
    });
  });

  it('broker e índice fora e Postgres travado → não pronto (só o banco conta)', async () => {
    process.env.CATALOG_RABBITMQ_URL = `amqp://127.0.0.1:${await freePort()}`;
    process.env.CATALOG_ELASTICSEARCH_URL = `http://127.0.0.1:${await freePort()}`;
    await start();
    await pause(postgres);
    try {
      expect(await readinessStatus()).toBe(503);
    } finally {
      await unpause(postgres);
    }
  });
});
