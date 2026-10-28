import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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

const exec = promisify(execFile);

// Os três serviços com dados seguem o mesmo padrão: migrations aplicadas com o
// role do serviço no schema dele (CA02, CA09) e readiness enxergando o banco
// (CA06, CA07). Cada serviço roda contra um Postgres real com o script de init.
const services: { name: string; role: ServiceRole; module: Type }[] = [
  { name: 'catalog', role: 'catalog_svc', module: CatalogModule },
  { name: 'orders', role: 'orders_svc', module: OrdersModule },
  { name: 'integration', role: 'integration_svc', module: IntegrationModule },
];

describe.each(services)(
  '$name + Postgres (integração)',
  ({ name, role, module }) => {
    const envVar = `${name.toUpperCase()}_DATABASE_URL`;
    let container: StartedPostgreSqlContainer;
    let app: INestApplication<App>;
    let databaseUrl: string;

    function migrateDeploy() {
      return exec(
        process.execPath,
        [
          'node_modules/prisma/build/index.js',
          'migrate',
          'deploy',
          '--config',
          `apps/${name}/prisma.config.ts`,
        ],
        { env: { ...process.env, [envVar]: databaseUrl } },
      );
    }

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

    it('migrate deploy registra a migration inicial em <schema>._prisma_migrations', async () => {
      await migrateDeploy();

      expect(await appliedMigrations()).toBe(1);
    });

    it('um segundo migrate deploy não tem nada pendente nem duplica a migration', async () => {
      const { stdout } = await migrateDeploy();

      expect(stdout).toContain('No pending migrations to apply');
      expect(await appliedMigrations()).toBe(1);
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
