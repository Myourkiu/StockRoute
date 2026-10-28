import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health/health.controller';
import { ProbesController } from './health/probes.controller';
import { PrismaService } from './prisma/prisma.service';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController, ProbesController],
  providers: [PrismaService],
})
export class OrdersModule {}
