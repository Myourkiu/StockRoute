import type { Client } from '@elastic/elasticsearch';
import type { ProductRecord } from '../products/products.repository';
import { ProductIndex, toDocument } from './product-index';
import { InvalidCursorError, SearchUnavailableError } from './search.errors';

const ID = '33333333-3333-4333-8333-333333333333';

const record: ProductRecord = {
  id: ID,
  supplierId: '11111111-1111-4111-8111-111111111111',
  name: 'Camiseta',
  description: 'Algodão',
  category: 'vestuario',
  tags: ['verão'],
  active: true,
  createdAt: new Date('2026-10-30T12:00:00.000Z'),
  updatedAt: new Date('2026-10-30T12:00:00.000Z'),
  variants: [
    {
      sku: 'CAM-P',
      attributes: { tamanho: 'P' },
      wholesalePriceCents: 1000,
      minQuantity: 6,
      available: 10,
    },
    {
      sku: 'CAM-G',
      attributes: { tamanho: 'G' },
      wholesalePriceCents: 5000,
      minQuantity: 6,
      available: 0,
    },
  ],
};

function mockClient() {
  return {
    search: jest.fn<Promise<unknown>, [unknown]>(),
    index: jest.fn<Promise<unknown>, [unknown]>(),
    indices: {
      existsAlias: jest.fn<Promise<boolean>, [unknown]>(),
      create: jest.fn<Promise<unknown>, [unknown]>(),
    },
  };
}

// Regras do índice que não precisam do ES real (T02): o documento indexado,
// a busca desligada sem cliente e o `ensure` que tenta de novo depois de falhar.
describe('ProductIndex', () => {
  it('toDocument guarda os preços de todas as variantes, o menor e o maior', () => {
    expect(toDocument(record)).toEqual({
      id: ID,
      supplierId: record.supplierId,
      name: 'Camiseta',
      description: 'Algodão',
      category: 'vestuario',
      tags: ['verão'],
      variantPricesCents: [1000, 5000],
      minPriceCents: 1000,
      maxPriceCents: 5000,
    });
  });

  describe('sem cliente (busca desligada)', () => {
    const index = new ProductIndex(null);

    it('search → SearchUnavailableError', async () => {
      await expect(index.search({})).rejects.toBeInstanceOf(
        SearchUnavailableError,
      );
    });

    it('ensure, upsert e remove não fazem nada, sem erro', async () => {
      await expect(index.ensure()).resolves.toBeUndefined();
      await expect(index.upsert(record)).resolves.toBeUndefined();
      await expect(index.remove(ID)).resolves.toBeUndefined();
    });
  });

  it('cursor inválido → InvalidCursorError, sem chamar o ES', async () => {
    const client = mockClient();
    const index = new ProductIndex(client as unknown as Client);

    await expect(
      index.search({ cursor: 'não+é/cursor' }),
    ).rejects.toBeInstanceOf(InvalidCursorError);
    expect(client.search).not.toHaveBeenCalled();
  });

  it('ensure que falhou tenta de novo na próxima chamada', async () => {
    const client = mockClient();
    client.indices.existsAlias
      .mockRejectedValueOnce(new Error('ES fora'))
      .mockResolvedValueOnce(true);
    const index = new ProductIndex(client as unknown as Client);

    await expect(index.ensure()).rejects.toThrow('ES fora');
    await expect(index.ensure()).resolves.toBeUndefined();
    expect(client.indices.existsAlias).toHaveBeenCalledTimes(2);
  });

  it('ensure bem-sucedido não consulta o ES de novo', async () => {
    const client = mockClient();
    client.indices.existsAlias.mockResolvedValue(true);
    const index = new ProductIndex(client as unknown as Client);

    await index.ensure();
    await index.ensure();

    expect(client.indices.existsAlias).toHaveBeenCalledTimes(1);
  });

  it('upsert garante o índice antes de gravar pelo alias', async () => {
    const client = mockClient();
    client.indices.existsAlias.mockResolvedValue(false);
    const index = new ProductIndex(client as unknown as Client);

    await index.upsert(record);

    expect(client.indices.create).toHaveBeenCalledWith(
      expect.objectContaining({ aliases: { products: {} } }),
    );
    expect(client.index).toHaveBeenCalledWith({
      index: 'products',
      id: ID,
      document: toDocument(record),
    });
    expect(client.indices.create.mock.invocationCallOrder[0]).toBeLessThan(
      client.index.mock.invocationCallOrder[0],
    );
  });
});
