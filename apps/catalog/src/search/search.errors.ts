// Erros da busca. Como os de produto, não conhecem transporte: o filtro do
// controller TCP os traduz em status.

// Cursor que não foi gerado pela busca (formato, versão ou ordem errados).
export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid cursor');
    this.name = 'InvalidCursorError';
  }
}

// O Elasticsearch não respondeu (fora, travado ou desligado). A busca responde
// 503; o GET por id e a escrita não dependem dele.
export class SearchUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Search unavailable', { cause });
    this.name = 'SearchUnavailableError';
  }
}
