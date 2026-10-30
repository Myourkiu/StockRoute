// Erros de domínio do catálogo. O controller TCP os traduz em status HTTP
// (rpc-error.ts), então o service e o repositório não conhecem transporte.
export class ProductNotFoundError extends Error {
  constructor(readonly productId: string) {
    super(`Product ${productId} not found`);
    this.name = 'ProductNotFoundError';
  }
}

export class SkuConflictError extends Error {
  constructor() {
    super('SKU already exists');
    this.name = 'SkuConflictError';
  }
}
