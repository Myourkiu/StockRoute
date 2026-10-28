import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { ProbesController } from './health/probes.controller';

@Module({
  imports: [TerminusModule],
  controllers: [ProbesController],
})
export class ErpMockModule {}
