import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { HealthController } from './health/health.controller';

@Module({
  imports: [],
  controllers: [CatalogController, HealthController],
  providers: [CatalogService],
})
export class CatalogModule {}
