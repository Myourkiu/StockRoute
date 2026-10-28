import { Module } from '@nestjs/common';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { HealthModule } from './health/health.module';

@Module({
  imports: [HealthModule],
  controllers: [GatewayController],
  providers: [GatewayService],
})
export class GatewayModule {}
