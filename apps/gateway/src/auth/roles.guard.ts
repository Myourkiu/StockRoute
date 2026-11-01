import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from './auth.guard';
import { Roles } from './roles.decorator';

// Roda depois do AuthGuard: a identidade já é válida, então papel errado é
// 403 (proibido), e não 401 (não autenticado).
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride(Roles, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles) {
      return true;
    }
    const { actor } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!roles.includes(actor.role)) {
      throw new ForbiddenException('Role not allowed for this action');
    }
    return true;
  }
}
