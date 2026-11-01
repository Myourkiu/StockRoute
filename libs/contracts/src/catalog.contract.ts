// Mensagens TCP entre o gateway e o catalog para produtos e variações.
// Mudar este arquivo é mudar o contrato entre serviços (gate humano).
export const CATALOG_PATTERNS = {
  create: { cmd: 'catalog.product.create' },
  update: { cmd: 'catalog.product.update' },
  deactivate: { cmd: 'catalog.product.deactivate' },
  addVariant: { cmd: 'catalog.product.add-variant' },
  updateVariant: { cmd: 'catalog.product.update-variant' },
  get: { cmd: 'catalog.product.get' },
} as const;

// Quem faz a chamada, já autenticado pelo gateway. O catalog confia nele e
// decide a posse: só o gateway vê o token.
export type Actor =
  { role: 'supplier'; supplierId: string } | { role: 'retailer' };

// Toda mensagem do catálogo leva o ator junto do dado.
export interface CatalogRequest<T> {
  actor: Actor;
  data: T;
}

export interface VariantInput {
  sku: string;
  attributes: Record<string, string>;
  wholesalePriceCents: number;
  minQuantity: number;
  initialStock: number;
}

export interface CreateProductData {
  name: string;
  description: string;
  category: string;
  tags: string[];
  variants: VariantInput[];
}

export interface ProductChangesData {
  name?: string;
  description?: string;
  category?: string;
  tags?: string[];
  active?: boolean;
}

export interface UpdateProductData {
  id: string;
  changes: ProductChangesData;
}

export interface ProductIdData {
  id: string;
}

export interface AddVariantData {
  id: string;
  variant: VariantInput;
}

// O SKU identifica a variante e não muda; o estoque não é editável.
export interface UpdateVariantData {
  id: string;
  sku: string;
  changes: {
    attributes?: Record<string, string>;
    wholesalePriceCents?: number;
    minQuantity?: number;
  };
}

export interface VariantView {
  sku: string;
  attributes: Record<string, string>;
  wholesalePriceCents: number;
  minQuantity: number;
  available: number;
}

export interface ProductView {
  id: string;
  supplierId: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
  variants: VariantView[];
}

// Formato do erro que o catalog devolve; o gateway o converte em HTTP.
export interface CatalogRpcError {
  status: 403 | 404 | 409 | 500;
  message: string;
}
