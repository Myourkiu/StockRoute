import { HttpException } from '@nestjs/common';
import type { CatalogRpcError } from '@stockroute/contracts';

const CONTRACT_STATUSES = new Set<number>([403, 404, 409, 500]);

// Converte o erro recebido do catalog por TCP numa resposta HTTP:
// - erro do contrato ({ status, message }) → o mesmo status;
// - Error (conexão recusada, timeout) → 503, o catalog está indisponível;
// - qualquer outra resposta de erro → 502, o catalog respondeu fora do contrato.
export function toHttpException(error: unknown): HttpException {
  if (isContractError(error)) {
    return httpError(error.status, error.message);
  }
  if (error instanceof Error) {
    return httpError(503, 'Catalog unavailable');
  }
  return httpError(502, 'Unexpected catalog response');
}

function isContractError(error: unknown): error is CatalogRpcError {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { status, message } = error as Record<string, unknown>;
  return (
    typeof status === 'number' &&
    CONTRACT_STATUSES.has(status) &&
    typeof message === 'string'
  );
}

function httpError(status: number, message: string) {
  return new HttpException({ statusCode: status, message }, status);
}
