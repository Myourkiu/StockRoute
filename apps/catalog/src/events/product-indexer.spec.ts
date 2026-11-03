import { Logger } from '@nestjs/common';
import type {
  ProductRecord,
  ProductsRepository,
} from '../products/products.repository';
import type { ProductIndex } from '../search/product-index';
import { ProductIndexer } from './product-indexer';

const ID = '33333333-3333-4333-8333-333333333333';

function record(active: boolean): ProductRecord {
  return {
    id: ID,
    supplierId: '11111111-1111-4111-8111-111111111111',
    name: 'Camiseta',
    description: 'Algodão',
    category: 'vestuario',
    tags: [],
    active,
    createdAt: new Date('2026-10-30T12:00:00.000Z'),
    updatedAt: new Date('2026-10-30T12:00:00.000Z'),
    variants: [
      {
        sku: 'CAM-P',
        attributes: {},
        wholesalePriceCents: 1000,
        minQuantity: 6,
        available: 10,
      },
    ],
  };
}

// Indexador (T03): o evento só diz qual produto mudou; o indexador relê o
// estado atual no banco. Ativo vai para o índice; inativo ou apagado sai (D15).
describe('ProductIndexer', () => {
  let findById: jest.Mock<
    ReturnType<ProductsRepository['findById']>,
    Parameters<ProductsRepository['findById']>
  >;
  let upsert: jest.Mock<
    ReturnType<ProductIndex['upsert']>,
    Parameters<ProductIndex['upsert']>
  >;
  let remove: jest.Mock<
    ReturnType<ProductIndex['remove']>,
    Parameters<ProductIndex['remove']>
  >;
  let indexer: ProductIndexer;
  let error: jest.SpyInstance;

  beforeEach(() => {
    findById = jest.fn();
    upsert = jest.fn();
    remove = jest.fn();
    indexer = new ProductIndexer(
      { findById } as unknown as ProductsRepository,
      { upsert, remove } as unknown as ProductIndex,
    );
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    error.mockRestore();
  });

  it('produto ativo → upsert com o produto lido do banco', async () => {
    const product = record(true);
    findById.mockResolvedValue(product);

    await indexer.sync(ID);

    expect(upsert).toHaveBeenCalledWith(product);
    expect(remove).not.toHaveBeenCalled();
  });

  it.each([
    ['inativo', record(false)],
    ['inexistente', null],
  ])('produto %s → remove do índice', async (_label, found) => {
    findById.mockResolvedValue(found);

    await indexer.sync(ID);

    expect(remove).toHaveBeenCalledWith(ID);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('banco falha → log de erro, sem relançar', async () => {
    findById.mockRejectedValue(new Error('banco fora'));

    await expect(indexer.sync(ID)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('banco fora'));
  });

  it('índice falha → log de erro, sem relançar', async () => {
    findById.mockResolvedValue(record(true));
    upsert.mockRejectedValue(new Error('ES fora'));

    await expect(indexer.sync(ID)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('ES fora'));
  });
});
