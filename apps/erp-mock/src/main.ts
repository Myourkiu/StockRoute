import { NestFactory } from '@nestjs/core';
import { ErpMockModule } from './erp-mock.module';

// Só HTTP, como um ERP externo de verdade, que não falaria o TCP do Nest.
async function bootstrap() {
  const app = await NestFactory.create(ErpMockModule);
  await app.listen(Number(process.env.ERP_MOCK_HTTP_PORT ?? 18204));
}
void bootstrap();
