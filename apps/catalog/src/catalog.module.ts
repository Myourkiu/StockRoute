import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health/health.controller';
import { ProbesController } from './health/probes.controller';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController, ProbesController],
})
export class CatalogModule {}
