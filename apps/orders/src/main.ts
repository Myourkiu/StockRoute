import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { OrdersModule } from './orders.module';

// App híbrida: TCP para as mensagens do gateway e HTTP interno para as probes.
async function bootstrap() {
  const app = await NestFactory.create(OrdersModule);
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: {
      host: '0.0.0.0',
      port: Number(process.env.ORDERS_TCP_PORT ?? 18102),
    },
  });
  await app.startAllMicroservices();
  await app.listen(Number(process.env.ORDERS_HTTP_PORT ?? 18202));
}
void bootstrap();
