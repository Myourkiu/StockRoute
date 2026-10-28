import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { CatalogModule } from './catalog.module';

// App híbrida: TCP para as mensagens do gateway e HTTP interno para as probes.
async function bootstrap() {
  const app = await NestFactory.create(CatalogModule);
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: {
      host: '0.0.0.0',
      port: Number(process.env.CATALOG_TCP_PORT ?? 18101),
    },
  });
  await app.startAllMicroservices();
  await app.listen(Number(process.env.CATALOG_HTTP_PORT ?? 18201));
}
void bootstrap();
