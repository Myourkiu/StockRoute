import { Injectable } from '@nestjs/common';
import type { ClientProxy } from '@nestjs/microservices';
import { HealthIndicatorService } from '@nestjs/terminus';
import { HEALTH_PATTERN } from '@stockroute/contracts';
import { firstValueFrom, fromEvent, takeUntil } from 'rxjs';

// Um serviço travado custa no máximo isso; o terminus roda os indicadores em
// paralelo, então a resposta agregada fica bem abaixo dos 3 s do CA05.
const HEALTH_TIMEOUT_MS = 1000;

@Injectable()
export class ServiceHealthIndicator {
  constructor(private readonly health: HealthIndicatorService) {}

  // Envia a mensagem de saúde do contrato e não só um ping TCP: um processo
  // travado aceita conexão, mas não responde mensagens (D07).
  isHealthy(key: string, client: ClientProxy) {
    return this.health
      .check(key)
      .attempt(async ({ signal }) => {
        // No timeout, o abort encerra a inscrição em vez de deixá-la pendurada.
        await firstValueFrom(
          client
            .send(HEALTH_PATTERN, {})
            .pipe(takeUntil(fromEvent(signal, 'abort'))),
        );
      })
      .withTimeout(HEALTH_TIMEOUT_MS);
  }
}
