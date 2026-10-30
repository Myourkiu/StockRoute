import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Actor } from '@stockroute/contracts';

export interface AuthenticatedRequest {
  headers: Record<string, string | undefined>;
  actor: Actor;
}

interface TokenClaims {
  sub?: unknown;
  role?: unknown;
  supplierId?: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Valida o JWT (assinatura HS256, validade) e transforma as claims no ator que
// segue para os serviços internos. Qualquer problema no token é 401, sem dizer
// qual: a mensagem não ajuda quem tenta forjar um token.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException();
    }
    let claims: TokenClaims;
    try {
      claims = await this.jwt.verifyAsync<TokenClaims>(token, {
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException();
    }
    request.actor = toActor(claims);
    return true;
  }
}

function toActor({ role, supplierId }: TokenClaims): Actor {
  if (role === 'retailer') {
    return { role };
  }
  if (
    role === 'supplier' &&
    typeof supplierId === 'string' &&
    UUID.test(supplierId)
  ) {
    return { role, supplierId };
  }
  throw new UnauthorizedException();
}
