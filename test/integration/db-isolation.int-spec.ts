import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import {
  DB_PASSWORDS,
  startPostgres,
  type ServiceRole,
} from './postgres-container';

// Prova o database per service por permissão (CA10): a credencial de um
// serviço funciona no próprio schema e é negada no schema dos outros.
describe('isolamento por schema e role (integração)', () => {
  let container: StartedPostgreSqlContainer;

  async function connectAs(role: ServiceRole) {
    const client = new Client({
      host: container.getHost(),
      port: container.getPort(),
      database: container.getDatabase(),
      user: role,
      password: DB_PASSWORDS[role],
    });
    await client.connect();
    return client;
  }

  beforeAll(async () => {
    container = await startPostgres();

    const orders = await connectAs('orders_svc');
    await orders.query('CREATE TABLE orders.sample (id int PRIMARY KEY)');
    await orders.end();
  });

  afterAll(async () => {
    await container.stop();
  });

  it('o role do catalog cria, insere e lê no schema catalog', async () => {
    const catalog = await connectAs('catalog_svc');
    try {
      await catalog.query('CREATE TABLE catalog.sample (id int PRIMARY KEY)');
      await catalog.query('INSERT INTO catalog.sample (id) VALUES (1)');
      const { rows } = await catalog.query('SELECT id FROM catalog.sample');

      expect(rows).toEqual([{ id: 1 }]);
    } finally {
      await catalog.end();
    }
  });

  it('o role do catalog não lê nem escreve no schema orders', async () => {
    const catalog = await connectAs('catalog_svc');
    try {
      await expect(
        catalog.query('SELECT * FROM orders.sample'),
      ).rejects.toThrow('permission denied for schema orders');
      await expect(
        catalog.query('INSERT INTO orders.sample (id) VALUES (1)'),
      ).rejects.toThrow('permission denied for schema orders');
    } finally {
      await catalog.end();
    }
  });

  it('o role do catalog não cria tabela no schema public', async () => {
    const catalog = await connectAs('catalog_svc');
    try {
      await expect(
        catalog.query('CREATE TABLE public.sample (id int)'),
      ).rejects.toThrow('permission denied for schema public');
    } finally {
      await catalog.end();
    }
  });
});
