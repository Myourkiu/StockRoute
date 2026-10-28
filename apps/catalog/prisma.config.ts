import { defineConfig } from 'prisma/config';

// Config do CLI do Prisma só para o catalog: cada serviço tem schema e
// histórico de migrations próprios. A URL usa o role catalog_svc e
// `?schema=catalog`, então o `_prisma_migrations` fica dentro do schema dele.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // `process.env` e não `env()`: o `prisma generate` não precisa de banco e
    // não deve falhar quando a variável não existe (ex.: no npm ci do CI).
    url: process.env.CATALOG_DATABASE_URL ?? '',
  },
});
