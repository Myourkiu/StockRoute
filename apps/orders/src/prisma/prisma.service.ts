import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

// Client do Prisma do orders, falando com o Postgres pelo driver `pg`.
// Não conecta no boot: se o banco estiver fora, o processo sobe mesmo assim e
// o readiness responde "não pronto" até o banco voltar.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({
      adapter: new PrismaPg(
        {
          connectionString: process.env.ORDERS_DATABASE_URL,
          connectionTimeoutMillis: 1000,
          // O timeout do terminus abandona a promise, mas não cancela a query:
          // sem este limite, uma query travada seguraria a conexão do pool.
          // Vale para o pool inteiro; rever quando o domínio chegar (Etapa 3).
          query_timeout: 1000,
        },
        { schema: 'orders' },
      ),
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
