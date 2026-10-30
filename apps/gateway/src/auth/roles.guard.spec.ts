import {
  Controller,
  ForbiddenException,
  Get,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Actor } from '@stockroute/contracts';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

@Controller()
class SampleController {
  @Get()
  @Roles('supplier')
  write(this: void) {}

  @Get()
  read(this: void) {}
}

function contextFor(handler: () => void, actor: Actor) {
  return {
    getHandler: () => handler,
    getClass: () => SampleController,
    switchToHttp: () => ({ getRequest: () => ({ actor }) }),
  } as unknown as ExecutionContext;
}

// RolesGuard (T05): compara o papel do ator, já autenticado pelo AuthGuard,
// com o @Roles da rota. Papel errado é 403, não 401: a identidade é válida.
describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());
  const { write, read } = SampleController.prototype;

  it('lojista em rota @Roles("supplier") → 403', () => {
    expect(() =>
      guard.canActivate(contextFor(write, { role: 'retailer' })),
    ).toThrow(ForbiddenException);
  });

  it('fornecedor em rota @Roles("supplier") → passa', () => {
    expect(
      guard.canActivate(
        contextFor(write, {
          role: 'supplier',
          supplierId: '11111111-1111-4111-8111-111111111111',
        }),
      ),
    ).toBe(true);
  });

  it('rota sem @Roles com lojista → passa', () => {
    expect(guard.canActivate(contextFor(read, { role: 'retailer' }))).toBe(
      true,
    );
  });
});
