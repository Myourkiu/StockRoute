import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { InternalClientsModule } from '../clients/clients.module';
import { HealthController } from './health.controller';
import { HttpHealthIndicator } from './http-health.indicator';
import { ProbesController } from './probes.controller';
import { ServiceHealthIndicator } from './service-health.indicator';

@Module({
  imports: [TerminusModule, InternalClientsModule],
  controllers: [HealthController, ProbesController],
  providers: [ServiceHealthIndicator, HttpHealthIndicator],
})
export class HealthModule {}
