import { encodeCursor } from './search-cursor';
import {
  buildSearchRequest,
  toSearchPage,
  type SearchHit,
} from './search-query';

const ID = '33333333-3333-4333-8333-333333333333';

function hit(n: number): SearchHit<{ id: string }> {
  return { _source: { id: `id-${n}` }, sort: [`Produto ${n}`, `id-${n}`] };
}

// Montagem da busca (T01): texto em nome, descrição e tags; filtros que não
// pontuam; ordem estável com o id como desempate; um item a mais para saber se
// existe próxima página.
describe('buildSearchRequest', () => {
  it('com texto: multi_match em name^3, description e tags, ordem por score e id', () => {
    const request = buildSearchRequest({ q: 'camiseta' });

    expect(request.query).toEqual({
      bool: {
        must: [
          {
            multi_match: {
              query: 'camiseta',
              fields: ['name^3', 'description', 'tags'],
            },
          },
        ],
        filter: [],
      },
    });
    expect(request.sort).toEqual([
      { _score: { order: 'desc' } },
      { id: 'asc' },
    ]);
  });

  it.each([
    ['sem q', {}],
    ['q só com espaços', { q: '   ' }],
  ])('%s: match_all, ordem por nome e id', (_, params) => {
    const request = buildSearchRequest(params);

    expect(request.query).toEqual({
      bool: { must: [{ match_all: {} }], filter: [] },
    });
    expect(request.sort).toEqual([{ 'name.keyword': 'asc' }, { id: 'asc' }]);
  });

  it('categoria vira filtro term dentro de bool.filter', () => {
    const request = buildSearchRequest({ category: 'vestuario' });

    expect(request.query).toMatchObject({
      bool: { filter: [{ term: { category: 'vestuario' } }] },
    });
  });

  it('faixa de preço vira range em variantPricesCents', () => {
    const both = buildSearchRequest({
      minPriceCents: 4000,
      maxPriceCents: 6000,
    });
    const onlyMin = buildSearchRequest({ minPriceCents: 4000 });

    expect(both.query).toMatchObject({
      bool: {
        filter: [{ range: { variantPricesCents: { gte: 4000, lte: 6000 } } }],
      },
    });
    expect(onlyMin.query).toMatchObject({
      bool: { filter: [{ range: { variantPricesCents: { gte: 4000 } } }] },
    });
  });

  it('preço mínimo 0 também filtra', () => {
    const request = buildSearchRequest({ minPriceCents: 0 });

    expect(request.query).toMatchObject({
      bool: { filter: [{ range: { variantPricesCents: { gte: 0 } } }] },
    });
  });

  it('pede um item a mais que o limite; sem limite, usa 20', () => {
    expect(buildSearchRequest({ limit: 5 }).size).toBe(6);
    expect(buildSearchRequest({}).size).toBe(21);
  });

  it('cursor vira search_after com os valores decodificados', () => {
    const request = buildSearchRequest({
      q: 'camiseta',
      cursor: encodeCursor([1.25, ID]),
    });

    expect(request.search_after).toEqual([1.25, ID]);
  });

  it('sem cursor, não manda search_after', () => {
    expect(buildSearchRequest({})).not.toHaveProperty('search_after');
  });

  it('não devolve os preços de todas as variantes no resultado', () => {
    const request = buildSearchRequest({});

    expect(request._source).not.toContain('variantPricesCents');
    expect(request._source).toEqual(
      expect.arrayContaining(['id', 'name', 'minPriceCents', 'maxPriceCents']),
    );
  });
});

describe('toSearchPage', () => {
  it('com um item a mais que o limite: corta e devolve o cursor do último item', () => {
    const hits = Array.from({ length: 21 }, (_, n) => hit(n + 1));

    const page = toSearchPage(hits, 20);

    expect(page.items).toHaveLength(20);
    expect(page.items[19]).toEqual({ id: 'id-20' });
    expect(page.nextCursor).toBe(encodeCursor(['Produto 20', 'id-20']));
  });

  it('com até o limite: última página, sem cursor', () => {
    const hits = Array.from({ length: 20 }, (_, n) => hit(n + 1));

    const page = toSearchPage(hits, 20);

    expect(page.items).toHaveLength(20);
    expect(page.nextCursor).toBeNull();
  });

  it('sem resultados: lista vazia, sem cursor', () => {
    expect(toSearchPage([], 20)).toEqual({ items: [], nextCursor: null });
  });
});
