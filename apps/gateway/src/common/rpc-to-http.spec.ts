import { HttpException } from '@nestjs/common';
import { TimeoutError } from 'rxjs';
import { toHttpException } from './rpc-to-http';

// Tradução de erro do catalog (TCP) para HTTP no gateway (T06, D07).
describe('toHttpException', () => {
  it.each([403, 404, 409, 500])(
    'erro do contrato com status %i vira HTTP %i com { statusCode, message }',
    (status) => {
      const error = toHttpException({ status, message: 'detalhe' });

      expect(error).toBeInstanceOf(HttpException);
      expect(error.getStatus()).toBe(status);
      expect(error.getResponse()).toEqual({
        statusCode: status,
        message: 'detalhe',
      });
    },
  );

  it('falha de transporte (catalog fora) vira 503', () => {
    const error = toHttpException(
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:18101'), {
        code: 'ECONNREFUSED',
      }),
    );

    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toEqual({
      statusCode: 503,
      message: 'Catalog unavailable',
    });
  });

  it('timeout esperando o catalog vira 503', () => {
    expect(toHttpException(new TimeoutError()).getStatus()).toBe(503);
  });

  it('resposta de erro fora do contrato vira 502 (o catalog respondeu, mas errado)', () => {
    expect(toHttpException({ status: 'error', message: 'x' }).getStatus()).toBe(
      502,
    );
  });
});
