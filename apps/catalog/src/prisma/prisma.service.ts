import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

// Client do Prisma do catalog, falando com o Postgres pelo driver `pg`.
// Não conecta no boot: se o banco estiver fora, o processo sobe mesmo assim e
// o readiness responde "não pronto" até o banco voltar.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({
      adapter: new PrismaPg(
        {
          connectionString: process.env.CATALOG_DATABASE_URL,
          connectionTimeoutMillis: 1000,
        },
        { schema: 'catalog' },
      ),
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
