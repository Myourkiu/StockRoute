import {
  RedisContainer,
  type StartedRedisContainer,
} from '@testcontainers/redis';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// Mesma imagem do Compose.
export function startRedis(): Promise<StartedRedisContainer> {
  return new RedisContainer('redis:8-alpine').start();
}

// Pausa (congela) um container: as conexões continuam abertas, mas nada
// responde. Simula uma dependência travada, e dá para despausar depois, o que
// o `stop` do Testcontainers não permite.
export async function pause(container: { getId(): string }) {
  await exec('docker', ['pause', container.getId()]);
}

export async function unpause(container: { getId(): string }) {
  await exec('docker', ['unpause', container.getId()]);
}
