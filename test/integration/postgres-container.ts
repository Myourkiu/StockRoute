import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { resolve } from 'node:path';

// Senhas só de teste, iguais às do .env.example.
export const DB_PASSWORDS = {
  catalog_svc: 'catalog_pw',
  orders_svc: 'orders_pw',
  integration_svc: 'integration_pw',
} as const;

export type ServiceRole = keyof typeof DB_PASSWORDS;

// Sobe o mesmo Postgres do Compose, com o mesmo script de init, para os testes
// enxergarem as permissões reais e não uma versão simplificada delas.
export function startPostgres(): Promise<StartedPostgreSqlContainer> {
  return new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('stockroute')
    .withEnvironment({
      CATALOG_DB_PASSWORD: DB_PASSWORDS.catalog_svc,
      ORDERS_DB_PASSWORD: DB_PASSWORDS.orders_svc,
      INTEGRATION_DB_PASSWORD: DB_PASSWORDS.integration_svc,
    })
    .withCopyFilesToContainer([
      {
        source: resolve(
          __dirname,
          '../../infra/postgres/init/01-roles-schemas.sh',
        ),
        target: '/docker-entrypoint-initdb.d/01-roles-schemas.sh',
        mode: 0o755,
      },
    ])
    .start();
}

export function connectionUrl(
  container: StartedPostgreSqlContainer,
  role: ServiceRole,
  schema: string,
): string {
  const host = container.getHost();
  const port = container.getPort();
  const db = container.getDatabase();
  return `postgresql://${role}:${DB_PASSWORDS[role]}@${host}:${port}/${db}?schema=${schema}`;
}
