import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { ProductCache } from './cache/product-cache';
import {
  productCacheOptionsProvider,
  redisProvider,
  RedisShutdown,
} from './cache/redis.provider';
import { HealthController } from './health/health.controller';
import { ProbesController } from './health/probes.controller';
import { PrismaService } from './prisma/prisma.service';
import { ProductsController } from './products/products.controller';
import { ProductsRepository } from './products/products.repository';
import { ProductsService } from './products/products.service';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController, ProbesController, ProductsController],
  providers: [
    PrismaService,
    ProductsRepository,
    ProductsService,
    redisProvider,
    productCacheOptionsProvider,
    ProductCache,
    RedisShutdown,
  ],
})
export class CatalogModule {}
