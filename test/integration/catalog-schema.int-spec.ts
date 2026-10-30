import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { SUPPLIER_ALFA, SUPPLIER_BETA } from '../fixtures/suppliers';
import {
  connectionUrl,
  DB_PASSWORDS,
  startPostgres,
  type ServiceRole,
} from './postgres-container';
import { migrateDeploy } from './prisma-migrate';

// Schema de domínio do catalog (T01): tabelas, restrições e seed de
// fornecedores, aplicados pelo mesmo `migrate deploy` do Compose.
describe('schema do catalog (integração)', () => {
  let container: StartedPostgreSqlContainer;
  let catalog: Client;

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

  async function insertProduct(id: string, supplierId = SUPPLIER_ALFA) {
    await catalog.query(
      `INSERT INTO catalog.products (id, supplier_id, name, description, category, tags, updated_at)
       VALUES ($1, $2, 'Camiseta', 'Algodão', 'vestuario', '{}', now())`,
      [id, supplierId],
    );
  }

  async function insertVariant(id: string, productId: string, sku: string) {
    await catalog.query(
      `INSERT INTO catalog.variants (id, product_id, sku, attributes, wholesale_price_cents, min_quantity, updated_at)
       VALUES ($1, $2, $3, '{}', 1000, 1, now())`,
      [id, productId, sku],
    );
  }

  beforeAll(async () => {
    container = await startPostgres();
    catalog = await connectAs('catalog_svc');
  });

  afterAll(async () => {
    await catalog?.end();
    await container.stop();
  });

  it('migrate deploy aplica as 3 migrations e cria os 2 fornecedores do seed', async () => {
    await migrateDeploy(
      'catalog',
      connectionUrl(container, 'catalog_svc', 'catalog'),
    );

    const migrations = await catalog.query(
      'SELECT count(*)::int AS n FROM catalog._prisma_migrations WHERE finished_at IS NOT NULL',
    );
    const suppliers = await catalog.query(
      'SELECT id FROM catalog.suppliers ORDER BY id',
    );
    expect(migrations.rows[0].n).toBe(3);
    expect(suppliers.rows.map((row) => row.id)).toEqual([
      SUPPLIER_ALFA,
      SUPPLIER_BETA,
    ]);
  });

  it('um segundo migrate deploy não tem nada pendente nem duplica os fornecedores', async () => {
    const { stdout } = await migrateDeploy(
      'catalog',
      connectionUrl(container, 'catalog_svc', 'catalog'),
    );

    const suppliers = await catalog.query(
      'SELECT count(*)::int AS n FROM catalog.suppliers',
    );
    expect(stdout).toContain('No pending migrations to apply');
    expect(suppliers.rows[0].n).toBe(2);
  });

  it('o SKU é único entre todas as variantes', async () => {
    await insertProduct('aaaaaaaa-0000-4000-8000-000000000001');
    await insertProduct('aaaaaaaa-0000-4000-8000-000000000002');
    await insertVariant(
      'bbbbbbbb-0000-4000-8000-000000000001',
      'aaaaaaaa-0000-4000-8000-000000000001',
      'SKU-DUP',
    );

    await expect(
      insertVariant(
        'bbbbbbbb-0000-4000-8000-000000000002',
        'aaaaaaaa-0000-4000-8000-000000000002',
        'SKU-DUP',
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('produto de fornecedor inexistente viola a chave estrangeira', async () => {
    await expect(
      insertProduct(
        'aaaaaaaa-0000-4000-8000-000000000003',
        '99999999-9999-4999-8999-999999999999',
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('estoque negativo viola a restrição do banco', async () => {
    await expect(
      catalog.query(
        `INSERT INTO catalog.stock (sku, available, updated_at) VALUES ('SKU-DUP', -1, now())`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('o role do orders não enxerga as tabelas do catalog', async () => {
    const orders = await connectAs('orders_svc');
    try {
      await expect(
        orders.query('SELECT * FROM catalog.products'),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await orders.end();
    }
  });
});
