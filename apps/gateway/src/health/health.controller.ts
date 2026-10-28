import { Controller, Get, Inject } from '@nestjs/common';
import type { ClientProxy } from '@nestjs/microservices';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { CATALOG_CLIENT } from './health.constants';
import { ServiceHealthIndicator } from './service-health.indicator';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly services: ServiceHealthIndicator,
    @Inject(CATALOG_CLIENT) private readonly catalog: ClientProxy,
  ) {}

  // Saúde agregada: 200 se todos estão up, 503 se algum está down.
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.services.isHealthy('catalog', this.catalog),
    ]);
  }
}
