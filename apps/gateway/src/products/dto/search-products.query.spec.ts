import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../../common/validation';
import { SearchProductsQuery } from './search-products.query';

// Validação da query da busca no gateway (fatia 3, T07). Query string chega
// sempre como texto: os números são convertidos de forma explícita, e só se
// forem inteiros escritos como inteiros.
describe('SearchProductsQuery', () => {
  const pipe = createValidationPipe();

  function transform(query: Record<string, unknown>) {
    return pipe.transform(query, {
      type: 'query',
      metatype: SearchProductsQuery,
    }) as Promise<SearchProductsQuery>;
  }

  async function invalidFields(query: Record<string, unknown>) {
    try {
      await transform(query);
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse() as {
        errors: { field: string }[];
      };
      return body.errors.map((e) => e.field).sort();
    }
    return [];
  }

  it('query vazia → válida, com limite 20', async () => {
    await expect(transform({})).resolves.toEqual({ limit: 20 });
  });

  it('preços como texto de inteiros viram números', async () => {
    await expect(
      transform({ minPriceCents: '4000', maxPriceCents: '6000' }),
    ).resolves.toMatchObject({ minPriceCents: 4000, maxPriceCents: 6000 });
  });

  it.each(['abc', '-1', '1.5', '', '1e3'])(
    'minPriceCents=%p → 400 com o campo',
    async (value) => {
      await expect(invalidFields({ minPriceCents: value })).resolves.toEqual([
        'minPriceCents',
      ]);
    },
  );

  it('mínimo maior que o máximo → 400 (CA18)', async () => {
    await expect(
      invalidFields({ minPriceCents: '6000', maxPriceCents: '4000' }),
    ).resolves.toEqual(['maxPriceCents']);
  });

  it('mínimo igual ao máximo → válido', async () => {
    await expect(
      invalidFields({ minPriceCents: '4000', maxPriceCents: '4000' }),
    ).resolves.toEqual([]);
  });

  it.each(['0', '51'])('limit=%s → 400', async (value) => {
    await expect(invalidFields({ limit: value })).resolves.toEqual(['limit']);
  });

  it('limit=50 → válido', async () => {
    await expect(transform({ limit: '50' })).resolves.toMatchObject({
      limit: 50,
    });
  });

  it.each([
    ['q', 'a'.repeat(201)],
    ['category', 'a'.repeat(101)],
    ['cursor', 'a'.repeat(513)],
  ])('%s acima do limite de tamanho → 400', async (field, value) => {
    await expect(invalidFields({ [field]: value })).resolves.toEqual([field]);
  });

  it('q só com espaços → busca sem texto (CA20)', async () => {
    const query = await transform({ q: '   ' });

    expect(query.q).toBeUndefined();
  });

  it('q com espaços nas pontas → texto sem eles', async () => {
    await expect(transform({ q: '  camiseta ' })).resolves.toMatchObject({
      q: 'camiseta',
    });
  });

  it('parâmetro repetido (vira lista) → 400', async () => {
    await expect(invalidFields({ category: ['a', 'b'] })).resolves.toEqual([
      'category',
    ]);
  });

  it('parâmetro desconhecido → 400', async () => {
    await expect(
      invalidFields({ supplierId: '11111111-1111-4111-8111-111111111111' }),
    ).resolves.toEqual(['supplierId']);
  });
});
