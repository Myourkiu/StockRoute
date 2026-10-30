import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Actor } from '@stockroute/contracts';
import type { AuthenticatedRequest } from './auth.guard';

// O ator que o AuthGuard anexou à requisição.
export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Actor =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().actor,
);
