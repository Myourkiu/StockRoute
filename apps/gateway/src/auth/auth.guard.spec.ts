import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Actor } from '@stockroute/contracts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AuthGuard } from './auth.guard';

const exec = promisify(execFile);

const SECRET = 'test-secret';
const SUPPLIER_ID = '11111111-1111-4111-8111-111111111111';

function contextWith(authorization?: string) {
  const request: { headers: Record<string, string>; actor?: Actor } = {
    headers: authorization ? { authorization } : {},
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

// AuthGuard (T05): só deixa passar token HS256 assinado com o segredo do
// gateway, dentro da validade e com claims coerentes, e anexa o ator.
describe('AuthGuard', () => {
  const jwt = new JwtService({
    secret: SECRET,
    signOptions: { expiresIn: '1h' },
  });
  const guard = new AuthGuard(jwt);

  async function check(authorization?: string) {
    const { context, request } = contextWith(authorization);
    const allowed = await guard.canActivate(context);
    return { allowed, actor: request.actor };
  }

  it('token de fornecedor válido passa e anexa o ator com o fornecedor', async () => {
    const token = jwt.sign({
      sub: SUPPLIER_ID,
      role: 'supplier',
      supplierId: SUPPLIER_ID,
    });

    await expect(check(`Bearer ${token}`)).resolves.toEqual({
      allowed: true,
      actor: { role: 'supplier', supplierId: SUPPLIER_ID },
    });
  });

  it('token de lojista válido passa e anexa o ator sem fornecedor', async () => {
    const token = jwt.sign({ sub: 'lojista-1', role: 'retailer' });

    await expect(check(`Bearer ${token}`)).resolves.toEqual({
      allowed: true,
      actor: { role: 'retailer' },
    });
  });

  it('sem header Authorization → 401', async () => {
    await expect(check()).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('header sem o prefixo Bearer → 401', async () => {
    const token = jwt.sign({ sub: 'x', role: 'retailer' });

    await expect(check(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('token assinado com outro segredo → 401', async () => {
    const forged = new JwtService({ secret: 'outro-segredo' }).sign({
      sub: 'x',
      role: 'retailer',
    });

    await expect(check(`Bearer ${forged}`)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('token expirado → 401', async () => {
    const expired = new JwtService({ secret: SECRET }).sign({
      sub: 'x',
      role: 'retailer',
      exp: Math.floor(Date.now() / 1000) - 10,
    });

    await expect(check(`Bearer ${expired}`)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('token assinado com outro algoritmo (HS512) e o segredo certo → 401', async () => {
    const token = jwt.sign(
      { sub: 'x', role: 'retailer' },
      { algorithm: 'HS512' },
    );

    await expect(check(`Bearer ${token}`)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('token sem a claim exp (nunca expiraria) → 401', async () => {
    const token = new JwtService({ secret: SECRET }).sign({
      sub: 'x',
      role: 'retailer',
    });

    await expect(check(`Bearer ${token}`)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it.each([
    ['papel desconhecido', { sub: 'x', role: 'admin' }],
    ['fornecedor sem supplierId', { sub: 'x', role: 'supplier' }],
    [
      'fornecedor com supplierId que não é UUID',
      { sub: 'x', role: 'supplier', supplierId: 'abc' },
    ],
  ])('%s → 401', async (_label, payload) => {
    await expect(check(`Bearer ${jwt.sign(payload)}`)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('npm run token gera um token que o guard aceita', async () => {
    const { stdout } = await exec(
      process.execPath,
      ['scripts/issue-token.mjs', 'supplier', SUPPLIER_ID],
      { env: { ...process.env, JWT_SECRET: SECRET } },
    );

    await expect(check(`Bearer ${stdout.trim()}`)).resolves.toEqual({
      allowed: true,
      actor: { role: 'supplier', supplierId: SUPPLIER_ID },
    });
  });
});
