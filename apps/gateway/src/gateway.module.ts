import { Module } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { createValidationPipe } from './common/validation';
import { HealthModule } from './health/health.module';
import { ProductsModule } from './products/products.module';

@Module({
  imports: [HealthModule, ProductsModule],
  // Pipe global registrado no módulo (e não no main.ts) para valer também
  // nos testes, que sobem o app a partir do módulo.
  providers: [{ provide: APP_PIPE, useFactory: createValidationPipe }],
})
export class GatewayModule {}
