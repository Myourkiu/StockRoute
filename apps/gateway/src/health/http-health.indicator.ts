import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';

const HEALTH_TIMEOUT_MS = 1000;

// Saúde de um serviço que só fala HTTP (o erp-mock, como um ERP externo).
// Usa o `fetch` do Node em vez do HttpHealthIndicator do terminus, que exigiria
// o @nestjs/axios só para isso.
@Injectable()
export class HttpHealthIndicator {
  constructor(private readonly health: HealthIndicatorService) {}

  isHealthy(key: string, url: string) {
    return this.health
      .check(key)
      .attempt(async ({ signal }) => {
        // O signal do terminus cancela a requisição no timeout.
        const response = await fetch(url, { signal });
        try {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
        } finally {
          // Só o status interessa, mas o corpo precisa ser consumido ou
          // cancelado: senão o undici segura a conexão a cada probe.
          await response.body?.cancel();
        }
      })
      .withTimeout(HEALTH_TIMEOUT_MS);
  }
}
