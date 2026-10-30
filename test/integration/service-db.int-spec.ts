import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { CatalogModule } from '../../apps/catalog/src/catalog.module';
import { IntegrationModule } from '../../apps/integration/src/integration.module';
import { OrdersModule } from '../../apps/orders/src/orders.module';
import {
  connectionUrl,
  startPostgres,
  type ServiceRole,
} from './postgres-container';
import { migrateDeploy } from './prisma-migrate';

// Os três serviços com dados seguem o mesmo padrão: migrations aplicadas com o
// role do serviço no schema dele (CA02, CA09) e readiness enxergando o banco
// (CA06, CA07). Cada serviço roda contra um Postgres real com o script de init.
// `migrations` é quantas o histórico de cada serviço tem hoje.
const services: {
  name: string;
  role: ServiceRole;
  module: Type;
  migrations: number;
}[] = [
  {
    name: 'catalog',
    role: 'catalog_svc',
    module: CatalogModule,
    migrations: 3,
  },
  { name: 'orders', role: 'orders_svc', module: OrdersModule, migrations: 1 },
  {
    name: 'integration',
    role: 'integration_svc',
    module: IntegrationModule,
    migrations: 1,
  },
];

describe.each(services)(
  '$name + Postgres (integração)',
  ({ name, role, module, migrations }) => {
    const envVar = `${name.toUpperCase()}_DATABASE_URL`;
    let container: StartedPostgreSqlContainer;
    let app: INestApplication<App>;
    let databaseUrl: string;

    async function appliedMigrations(): Promise<number> {
      const client = new Client({
        connectionString: databaseUrl.replace(`?schema=${name}`, ''),
      });
      await client.connect();
      try {
        const { rows } = await client.query<{ count: string }>(
          `SELECT count(*) FROM ${name}._prisma_migrations WHERE finished_at IS NOT NULL`,
        );
        return Number(rows[0].count);
      } finally {
        await client.end();
      }
    }

    beforeAll(async () => {
      container = await startPostgres();
      databaseUrl = connectionUrl(container, role, name);
    });

    afterAll(async () => {
      await app?.close();
      await container.stop().catch(() => undefined);
      delete process.env[envVar];
    });

    it('migrate deploy registra as migrations em <schema>._prisma_migrations', async () => {
      await migrateDeploy(name, databaseUrl);

      expect(await appliedMigrations()).toBe(migrations);
    });

    it('um segundo migrate deploy não tem nada pendente nem duplica migrations', async () => {
      const { stdout } = await migrateDeploy(name, databaseUrl);

      expect(stdout).toContain('No pending migrations to apply');
      expect(await appliedMigrations()).toBe(migrations);
    });

    it('com o banco no ar, /health/ready responde 200', async () => {
      process.env[envVar] = databaseUrl;
      const moduleRef = await Test.createTestingModule({
        imports: [module],
      }).compile();
      app = moduleRef.createNestApplication();
      await app.init();

      const response = await request(app.getHttpServer()).get('/health/ready');

      expect(response.status).toBe(200);
      expect(response.body.details.database.status).toBe('up');
    });

    it('com o banco parado, /health/ready responde 503 em menos de 3 s e /health/live continua 200', async () => {
      await container.stop();
      const started = Date.now();

      const ready = await request(app.getHttpServer()).get('/health/ready');
      const elapsed = Date.now() - started;
      const live = await request(app.getHttpServer()).get('/health/live');

      expect(ready.status).toBe(503);
      expect(ready.body.details.database.status).toBe('down');
      expect(elapsed).toBeLessThan(3000);
      expect(live.status).toBe(200);
    });
  },
);
