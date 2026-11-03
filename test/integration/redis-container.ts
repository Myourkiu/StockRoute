import {
  RedisContainer,
  type StartedRedisContainer,
} from '@testcontainers/redis';

// Mesma imagem do Compose.
export function startRedis(): Promise<StartedRedisContainer> {
  return new RedisContainer('redis:8-alpine').start();
}
