import { NestFactory } from '@nestjs/core';
import { CatalogModule } from './catalog.module';

async function bootstrap() {
  const app = await NestFactory.create(CatalogModule);
  await app.listen(Number(process.env.CATALOG_HTTP_PORT ?? 18201));
}
void bootstrap();
