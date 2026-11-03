import type { estypes } from '@elastic/elasticsearch';
import type { SearchProductsData } from '@stockroute/contracts';
import {
  decodeCursor,
  encodeCursor,
  type SearchMode,
  type SortValues,
} from './search-cursor';

export const DEFAULT_LIMIT = 20;

export type SearchParams = SearchProductsData;

export interface SearchHit<T> {
  _source: T;
  sort: SortValues;
}

export interface SearchPage<T> {
  items: T[];
  nextCursor: string | null;
}

// Os campos que voltam no resultado. Os preços de todas as variantes servem
// só ao filtro; o resultado traz o menor e o maior.
const RESULT_FIELDS = [
  'id',
  'supplierId',
  'name',
  'description',
  'category',
  'tags',
  'minPriceCents',
  'maxPriceCents',
];

export function searchMode(params: SearchParams): SearchMode {
  return params.q?.trim() ? 'text' : 'browse';
}

// Os filtros ficam em `bool.filter`, que não pontua: categoria e preço
// restringem o resultado sem mudar a relevância do texto. O id desempata a
// ordem, o que a torna estável entre as páginas.
export function buildSearchRequest(
  params: SearchParams,
): Omit<estypes.SearchRequest, 'index'> {
  const mode = searchMode(params);
  const limit = params.limit ?? DEFAULT_LIMIT;
  const request: Omit<estypes.SearchRequest, 'index'> = {
    query: {
      bool: {
        must: [
          mode === 'text'
            ? {
                multi_match: {
                  query: params.q!.trim(),
                  fields: ['name^3', 'description', 'tags'],
                },
              }
            : { match_all: {} },
        ],
        filter: filters(params),
      },
    },
    sort:
      mode === 'text'
        ? [{ _score: { order: 'desc' } }, { id: 'asc' }]
        : [{ 'name.keyword': 'asc' }, { id: 'asc' }],
    // Um a mais que o limite: se ele vier, existe próxima página.
    size: limit + 1,
    _source: RESULT_FIELDS,
    track_total_hits: false,
  };
  if (params.cursor !== undefined) {
    request.search_after = decodeCursor(params.cursor, mode);
  }
  return request;
}

// O range num campo com vários valores casa se algum deles estiver na faixa:
// o produto aparece quando ao menos uma variante cabe no preço pedido.
function filters(params: SearchParams): estypes.QueryDslQueryContainer[] {
  const result: estypes.QueryDslQueryContainer[] = [];
  if (params.category !== undefined) {
    result.push({ term: { category: params.category } });
  }
  if (
    params.minPriceCents !== undefined ||
    params.maxPriceCents !== undefined
  ) {
    result.push({
      range: {
        variantPricesCents: {
          ...(params.minPriceCents !== undefined && {
            gte: params.minPriceCents,
          }),
          ...(params.maxPriceCents !== undefined && {
            lte: params.maxPriceCents,
          }),
        },
      },
    });
  }
  return result;
}

export function toSearchPage<T>(
  hits: SearchHit<T>[],
  limit: number,
): SearchPage<T> {
  const page = hits.slice(0, limit);
  const hasMore = hits.length > limit;
  return {
    items: page.map((hit) => hit._source),
    nextCursor: hasMore ? encodeCursor(page[page.length - 1].sort) : null,
  };
}
