import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { TerminusModule } from '@nestjs/terminus';
import {
  CATALOG_CLIENT,
  INTEGRATION_CLIENT,
  ORDERS_CLIENT,
} from './health.constants';
import { HealthController } from './health.controller';
import { HttpHealthIndicator } from './http-health.indicator';
import { ProbesController } from './probes.controller';
import { ServiceHealthIndicator } from './service-health.indicator';

// Client TCP de um serviço interno, com host e porta lidos do ambiente.
// registerAsync lê o ambiente na criação do módulo, e não no import do
// arquivo; é isso que permite ao e2e apontar para serviços em portas livres.
function tcpClient(name: string, prefix: string, defaultPort: number) {
  return {
    name,
    useFactory: () => ({
      transport: Transport.TCP as const,
      options: {
        host: process.env[`${prefix}_TCP_HOST`] ?? '127.0.0.1',
        port: Number(process.env[`${prefix}_TCP_PORT`] ?? defaultPort),
      },
    }),
  };
}

@Module({
  imports: [
    TerminusModule,
    ClientsModule.registerAsync([
      tcpClient(CATALOG_CLIENT, 'CATALOG', 18101),
      tcpClient(ORDERS_CLIENT, 'ORDERS', 18102),
      tcpClient(INTEGRATION_CLIENT, 'INTEGRATION', 18103),
    ]),
  ],
  controllers: [HealthController, ProbesController],
  providers: [ServiceHealthIndicator, HttpHealthIndicator],
})
export class HealthModule {}
