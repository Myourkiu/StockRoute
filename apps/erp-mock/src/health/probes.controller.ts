import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';

// Probes do erp-mock. Sem banco nem dependências: live e ready respondem só
// sobre o processo. Latência e falhas simuladas chegam na Etapa 4.
@Controller('health')
export class ProbesController {
  constructor(private readonly health: HealthCheckService) {}

  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([]);
  }

  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([]);
  }
}
