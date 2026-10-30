// Erros de domínio do catálogo. O controller TCP os traduz em status HTTP
// (rpc-error.ts), então o service e o repositório não conhecem transporte.
export class ProductNotFoundError extends Error {
  constructor(readonly productId: string) {
    super(`Product ${productId} not found`);
    this.name = 'ProductNotFoundError';
  }
}

// Escrita pedida por quem não é fornecedor. O gateway já barra com 403; o
// catalog repete a checagem para não depender só dele.
export class ForbiddenActionError extends Error {
  constructor() {
    super('Only suppliers can change products');
    this.name = 'ForbiddenActionError';
  }
}

export class SkuConflictError extends Error {
  constructor() {
    super('SKU already exists');
    this.name = 'SkuConflictError';
  }
}
