import { Controller, Logger } from '@nestjs/common';
import {
  Ctx,
  EventPattern,
  Payload,
  type RmqContext,
  Transport,
} from '@nestjs/microservices';
import {
  CATALOG_EVENTS,
  type ProductUpsertedEvent,
} from '@stockroute/contracts';
import { ProductIndexer } from './product-indexer';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Consumidor do evento de produto, só no transporte RMQ (o catalog também
// escuta TCP). Sempre dá ack: sem dead-letter queue, devolver a mensagem para
// a fila a faria voltar em loop. O que se perder, a reindexação corrige.
@Controller()
export class ProductIndexerController {
  private readonly logger = new Logger(ProductIndexerController.name);

  constructor(private readonly indexer: ProductIndexer) {}

  // `<string>` escolhe a assinatura sem tipo do Nest: a tipada exige `unknown`
  // em todo parâmetro depois do dado, e o contexto do RMQ é um `RmqContext`.
  @EventPattern<string>(CATALOG_EVENTS.productUpserted, Transport.RMQ)
  async onProductUpserted(
    @Payload() event: unknown,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    try {
      if (isProductUpsertedEvent(event)) {
        await this.indexer.sync(event.productId);
      } else {
        this.logger.warn('Ignoring malformed product event');
      }
    } catch (error) {
      this.logger.error(`Product event failed: ${(error as Error).message}`);
    } finally {
      const channel = context.getChannelRef() as {
        ack(message: unknown): void;
      };
      channel.ack(context.getMessage());
    }
  }
}

function isProductUpsertedEvent(value: unknown): value is ProductUpsertedEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { productId?: unknown }).productId === 'string' &&
    UUID.test((value as { productId: string }).productId)
  );
}
