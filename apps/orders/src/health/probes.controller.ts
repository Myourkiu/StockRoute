import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';

const DATABASE_TIMEOUT_MS = 1000;

// Probes HTTP internas do orders. Liveness não olha o banco: se olhasse, um
// banco fora faria o orquestrador reiniciar um processo saudável em loop.
@Controller('health')
export class ProbesController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([]);
  }

  // Readiness depende do banco: sem ele, o orders não atende ninguém.
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () =>
        this.indicator
          .check('database')
          .attempt(async () => {
            await this.prisma.$queryRaw`SELECT 1`;
          })
          .withTimeout(DATABASE_TIMEOUT_MS),
    ]);
  }
}
