import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';

// Probes do processo do gateway. O readiness não consulta os serviços internos:
// se consultasse, um serviço fora do ar tiraria o gateway inteiro do tráfego.
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
