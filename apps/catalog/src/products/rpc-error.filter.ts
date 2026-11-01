import {
  Catch,
  Logger,
  type ArgumentsHost,
  type RpcExceptionFilter,
} from '@nestjs/common';
import type { CatalogRpcError } from '@stockroute/contracts';
import { throwError, type Observable } from 'rxjs';
import {
  ForbiddenActionError,
  ProductNotFoundError,
  SkuConflictError,
} from './product.errors';

// Traduz os erros de domínio no formato de erro do contrato. O client TCP do
// gateway recebe esse objeto como erro e o converte em HTTP. Um erro
// inesperado é logado aqui e sai sem detalhes internos.
@Catch()
export class CatalogRpcErrorFilter implements RpcExceptionFilter {
  private readonly logger = new Logger(CatalogRpcErrorFilter.name);

  catch(error: unknown, _host: ArgumentsHost): Observable<never> {
    return throwError(() => this.toRpcError(error));
  }

  private toRpcError(error: unknown): CatalogRpcError {
    if (error instanceof ProductNotFoundError) {
      return { status: 404, message: error.message };
    }
    if (error instanceof ForbiddenActionError) {
      return { status: 403, message: error.message };
    }
    if (error instanceof SkuConflictError) {
      return { status: 409, message: error.message };
    }
    this.logger.error(error);
    return { status: 500, message: 'Internal error' };
  }
}
