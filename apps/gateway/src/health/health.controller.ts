import { Controller, Get, Inject } from '@nestjs/common';
import type { ClientProxy } from '@nestjs/microservices';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import {
  CATALOG_CLIENT,
  INTEGRATION_CLIENT,
  ORDERS_CLIENT,
} from './health.constants';
import { HttpHealthIndicator } from './http-health.indicator';
import { ServiceHealthIndicator } from './service-health.indicator';

@Controller('health')
export class HealthController {
  private readonly erpMockUrl = `${process.env.ERP_MOCK_URL ?? 'http://127.0.0.1:18204'}/health/ready`;

  constructor(
    private readonly health: HealthCheckService,
    private readonly services: ServiceHealthIndicator,
    private readonly http: HttpHealthIndicator,
    @Inject(CATALOG_CLIENT) private readonly catalog: ClientProxy,
    @Inject(ORDERS_CLIENT) private readonly orders: ClientProxy,
    @Inject(INTEGRATION_CLIENT) private readonly integration: ClientProxy,
  ) {}

  // Saúde agregada: 200 se todos estão up, 503 se algum está down. Os
  // indicadores rodam em paralelo, então o pior caso é ~1 s, não 4 s.
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.services.isHealthy('catalog', this.catalog),
      () => this.services.isHealthy('orders', this.orders),
      () => this.services.isHealthy('integration', this.integration),
      () => this.http.isHealthy('erp-mock', this.erpMockUrl),
    ]);
  }
}
