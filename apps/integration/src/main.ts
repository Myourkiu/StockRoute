import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { IntegrationModule } from './integration.module';

// App híbrida: TCP para as mensagens do gateway e HTTP interno para as probes.
async function bootstrap() {
  const app = await NestFactory.create(IntegrationModule);
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: {
      host: '0.0.0.0',
      port: Number(process.env.INTEGRATION_TCP_PORT ?? 18103),
    },
  });
  await app.startAllMicroservices();
  await app.listen(Number(process.env.INTEGRATION_HTTP_PORT ?? 18203));
}
void bootstrap();
