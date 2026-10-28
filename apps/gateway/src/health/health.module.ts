import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { TerminusModule } from '@nestjs/terminus';
import { CATALOG_CLIENT } from './health.constants';
import { HealthController } from './health.controller';
import { ProbesController } from './probes.controller';
import { ServiceHealthIndicator } from './service-health.indicator';

@Module({
  imports: [
    TerminusModule,
    // registerAsync lê o ambiente na criação do módulo, e não no import do
    // arquivo; é isso que permite ao e2e apontar para um catalog em porta livre.
    ClientsModule.registerAsync([
      {
        name: CATALOG_CLIENT,
        useFactory: () => ({
          transport: Transport.TCP,
          options: {
            host: process.env.CATALOG_TCP_HOST ?? '127.0.0.1',
            port: Number(process.env.CATALOG_TCP_PORT ?? 18101),
          },
        }),
      },
    ]),
  ],
  controllers: [HealthController, ProbesController],
  providers: [ServiceHealthIndicator],
})
export class HealthModule {}
