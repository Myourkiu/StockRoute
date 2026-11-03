import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ClientProxy } from '@nestjs/microservices';
import {
  CATALOG_EVENTS,
  type ProductUpsertedEvent,
} from '@stockroute/contracts';
import { timeout } from 'rxjs';
import { CATALOG_EVENTS_CLIENT } from './rabbitmq.provider';

const PUBLISH_TIMEOUT_MS = 5000;

// Publica que um produto mudou, depois que a escrita já foi confirmada no
// banco. Dispara e não espera: um broker fora ou lento não atrasa nem derruba
// a escrita, só vira log. É o dual write aceito de propósito (sem outbox); o
// evento perdido é corrigido pela reindexação.
@Injectable()
export class ProductEvents {
  private readonly logger = new Logger(ProductEvents.name);

  constructor(
    @Inject(CATALOG_EVENTS_CLIENT) private readonly client: ClientProxy | null,
  ) {}

  publishUpserted(productId: string): void {
    if (!this.client) {
      return;
    }
    const event: ProductUpsertedEvent = {
      productId,
      occurredAt: new Date().toISOString(),
    };
    this.client
      .emit(CATALOG_EVENTS.productUpserted, event)
      .pipe(timeout(PUBLISH_TIMEOUT_MS))
      .subscribe({
        // O client do Nest rejeita com texto, e não com Error, enquanto reconecta.
        error: (error: unknown) =>
          this.logger.warn(
            `Event for product ${productId} not published: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
      });
  }
}
