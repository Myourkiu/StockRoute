import { NestFactory } from '@nestjs/core';
import { GatewayModule } from './gateway.module';

async function bootstrap() {
  const app = await NestFactory.create(GatewayModule);
  await app.listen(Number(process.env.GATEWAY_HTTP_PORT ?? 18000));
}
void bootstrap();
