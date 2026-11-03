// Erros da busca. Como os de produto, não conhecem transporte: o filtro do
// controller TCP os traduz em status.

// Cursor que não foi gerado pela busca (formato, versão ou ordem errados).
export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid cursor');
    this.name = 'InvalidCursorError';
  }
}
