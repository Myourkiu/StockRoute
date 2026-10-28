import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { HEALTH_PATTERN, type HealthResponse } from '@stockroute/contracts';

@Controller()
export class HealthController {
  @MessagePattern(HEALTH_PATTERN)
  health(): HealthResponse {
    return { service: 'catalog', status: 'up' };
  }
}
