import type { estypes } from '@elastic/elasticsearch';
import type { ProductSearchItem } from '@stockroute/contracts';

// A busca e o indexador sempre usam o alias. O índice real tem o timestamp no
// nome, para a reindexação construir um novo ao lado e só então trocar o alias.
export const PRODUCTS_ALIAS = 'products';
export const PRODUCTS_INDEX_PREFIX = 'products_';

// O documento é o item da busca mais os preços de todas as variantes, que só
// servem ao filtro.
export interface ProductDocument extends ProductSearchItem {
  variantPricesCents: number[];
}

// Um shard e nenhuma réplica: é um nó só, e com réplica o índice ficaria
// amarelo para sempre. Um shard também deixa o score igual entre as buscas.
export const PRODUCT_INDEX_SETTINGS: estypes.IndicesIndexSettings = {
  number_of_shards: 1,
  number_of_replicas: 0,
};

// Mapping estrito: um campo fora daqui é erro, em vez de virar um tipo
// adivinhado pelo ES.
// - nome e descrição: texto com o analyzer `brazilian` (minúsculas, stopwords
//   e radical, então "camisetas" acha "Camiseta"); o nome tem também um
//   `keyword`, para ordenar a busca sem texto;
// - categoria, tags e fornecedor: `keyword`, que casa o valor exato;
// - preços em centavos: o array de todas as variantes serve ao filtro; o menor
//   e o maior vão no resultado.
export const PRODUCT_INDEX_MAPPINGS: estypes.MappingTypeMapping = {
  dynamic: 'strict',
  properties: {
    id: { type: 'keyword' },
    supplierId: { type: 'keyword' },
    name: {
      type: 'text',
      analyzer: 'brazilian',
      fields: { keyword: { type: 'keyword' } },
    },
    description: { type: 'text', analyzer: 'brazilian' },
    category: { type: 'keyword' },
    tags: { type: 'keyword' },
    variantPricesCents: { type: 'long' },
    minPriceCents: { type: 'long' },
    maxPriceCents: { type: 'long' },
  },
};
