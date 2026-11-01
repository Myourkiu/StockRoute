import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// Roda o `prisma migrate deploy` de um serviço contra a URL dada, do mesmo
// jeito que o migrator do Compose (mesma config, mesmo CLI).
export function migrateDeploy(service: string, databaseUrl: string) {
  return exec(
    process.execPath,
    [
      'node_modules/prisma/build/index.js',
      'migrate',
      'deploy',
      '--config',
      `apps/${service}/prisma.config.ts`,
    ],
    {
      env: {
        ...process.env,
        [`${service.toUpperCase()}_DATABASE_URL`]: databaseUrl,
      },
    },
  );
}
