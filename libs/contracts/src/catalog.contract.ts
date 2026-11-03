// Mensagens TCP entre o gateway e o catalog para produtos e variações.
// Mudar este arquivo é mudar o contrato entre serviços (gate humano).
export const CATALOG_PATTERNS = {
  create: { cmd: 'catalog.product.create' },
  update: { cmd: 'catalog.product.update' },
  deactivate: { cmd: 'catalog.product.deactivate' },
  addVariant: { cmd: 'catalog.product.add-variant' },
  updateVariant: { cmd: 'catalog.product.update-variant' },
  get: { cmd: 'catalog.product.get' },
  search: { cmd: 'catalog.product.search' },
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

// Filtros da busca, iguais para lojista e fornecedor. Preços em centavos; o
// cursor é opaco para o cliente (vem do `nextCursor` da página anterior).
export interface SearchProductsData {
  q?: string;
  category?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  cursor?: string;
  limit?: number;
}

// Item da busca: o que o índice guarda do produto, com o menor e o maior
// preço entre as variantes. O estoque não vem na busca, só no GET por id.
export interface ProductSearchItem {
  id: string;
  supplierId: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  minPriceCents: number;
  maxPriceCents: number;
}

// `nextCursor` nulo: é a última página.
export interface ProductSearchPage {
  items: ProductSearchItem[];
  nextCursor: string | null;
}

// Formato do erro que o catalog devolve; o gateway o converte em HTTP.
// 400 é cursor de busca inválido; 503, o índice de busca indisponível.
export interface CatalogRpcError {
  status: 400 | 403 | 404 | 409 | 500 | 503;
  message: string;
}

// Eventos que o catalog publica no RabbitMQ. Hoje quem consome é o próprio
// catalog (o indexador da busca); o contrato fica aqui como o das mensagens TCP.
export const CATALOG_EVENTS = {
  productUpserted: 'catalog.product.upserted',
} as const;

// Evento magro: diz só qual produto mudou e quando. Quem consome relê o estado
// atual no banco, então a ordem e a repetição dos eventos não importam.
export interface ProductUpsertedEvent {
  productId: string;
  occurredAt: string;
}
