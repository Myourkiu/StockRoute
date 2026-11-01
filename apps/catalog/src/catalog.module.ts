import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health/health.controller';
import { ProbesController } from './health/probes.controller';
import { PrismaService } from './prisma/prisma.service';
import { ProductsController } from './products/products.controller';
import { ProductsRepository } from './products/products.repository';
import { ProductsService } from './products/products.service';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController, ProbesController, ProductsController],
  providers: [PrismaService, ProductsRepository, ProductsService],
})
export class CatalogModule {}
