import { Logger } from '@nestjs/common';
import type {
  ProductRecord,
  ProductsRepository,
} from '../products/products.repository';
import type { ProductIndex } from './product-index';
import { Reindexer } from './reindexer';

const NEW_INDEX = 'products_2000';

function products(count: number, offset = 0): ProductRecord[] {
  return Array.from({ length: count }, (_, n) => ({
    id: `id-${String(offset + n + 1).padStart(5, '0')}`,
    supplierId: '11111111-1111-4111-8111-111111111111',
    name: `Produto ${offset + n + 1}`,
    description: '',
    category: 'vestuario',
    tags: [],
    active: true,
    createdAt: new Date('2026-11-03T12:00:00.000Z'),
    updatedAt: new Date('2026-11-03T12:00:00.000Z'),
    variants: [],
  }));
}

function mockRepository(pages: ProductRecord[][]) {
  const findActivePage = jest.fn<
    ReturnType<ProductsRepository['findActivePage']>,
    Parameters<ProductsRepository['findActivePage']>
  >();
  for (const page of pages) {
    findActivePage.mockResolvedValueOnce(page);
  }
  findActivePage.mockResolvedValue([]);
  return { findActivePage };
}

function mockIndex() {
  const calls: string[] = [];
  const index = {
    createIndex: jest.fn(() => {
      calls.push('create');
      return Promise.resolve(NEW_INDEX);
    }),
    bulkIndex: jest.fn((_name: string, _items: ProductRecord[]) => {
      calls.push('bulk');
      return Promise.resolve();
    }),
    refresh: jest.fn((_name: string) => {
      calls.push('refresh');
      return Promise.resolve();
    }),
    swapAlias: jest.fn((_name: string) => {
      calls.push('swap');
      return Promise.resolve(['products_1000']);
    }),
    deleteIndex: jest.fn((name: string) => {
      calls.push(`delete ${name}`);
      return Promise.resolve();
    }),
  };
  return { index, calls };
}

// Reindexação (fatia 4, T09): índice novo ao lado do atual, preenchido em
// lotes de 500 lidos do banco, e só então o alias troca. Se algo falhar antes
// da troca, a busca continua no índice antigo e o novo é apagado.
describe('Reindexer', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    warn.mockRestore();
  });

  function reindexer(
    repository: ReturnType<typeof mockRepository>,
    index: ReturnType<typeof mockIndex>['index'],
  ) {
    return new Reindexer(
      repository as unknown as ProductsRepository,
      index as unknown as ProductIndex,
    );
  }

  it('1.201 produtos → lotes de 500, 500 e 201, troca o alias e apaga o antigo', async () => {
    const repository = mockRepository([
      products(500),
      products(500, 500),
      products(201, 1000),
    ]);
    const { index, calls } = mockIndex();

    const count = await reindexer(repository, index).run();

    expect(count).toBe(1201);
    expect(index.bulkIndex.mock.calls.map(([, items]) => items.length)).toEqual(
      [500, 500, 201],
    );
    expect(
      index.bulkIndex.mock.calls.every(([name]) => name === NEW_INDEX),
    ).toBe(true);
    expect(repository.findActivePage.mock.calls).toEqual([
      [null, 500],
      ['id-00500', 500],
      ['id-01000', 500],
    ]);
    expect(calls).toEqual([
      'create',
      'bulk',
      'bulk',
      'bulk',
      'refresh',
      'swap',
      'delete products_1000',
    ]);
    expect(index.swapAlias).toHaveBeenCalledWith(NEW_INDEX);
  });

  it('página cheia no fim (exatamente 500) → pede mais uma e para na vazia', async () => {
    const repository = mockRepository([products(500)]);
    const { index } = mockIndex();

    await expect(reindexer(repository, index).run()).resolves.toBe(500);
    expect(repository.findActivePage).toHaveBeenCalledTimes(2);
  });

  it('banco sem produto ativo → índice novo vazio, e o alias troca mesmo assim', async () => {
    const repository = mockRepository([]);
    const { index, calls } = mockIndex();

    await expect(reindexer(repository, index).run()).resolves.toBe(0);
    expect(calls).toEqual([
      'create',
      'refresh',
      'swap',
      'delete products_1000',
    ]);
  });

  it('bulk falha → apaga o índice novo, não troca o alias, e o erro sobe', async () => {
    const repository = mockRepository([products(10)]);
    const { index, calls } = mockIndex();
    index.bulkIndex.mockImplementationOnce(() => {
      calls.push('bulk');
      return Promise.reject(new Error('item rejeitado'));
    });

    await expect(reindexer(repository, index).run()).rejects.toThrow(
      'item rejeitado',
    );
    expect(index.swapAlias).not.toHaveBeenCalled();
    expect(calls).toEqual(['create', 'bulk', `delete ${NEW_INDEX}`]);
  });

  it('banco falha no meio → apaga o índice novo, não troca o alias, e o erro sobe', async () => {
    const repository = mockRepository([products(500)]);
    repository.findActivePage.mockReset();
    repository.findActivePage
      .mockResolvedValueOnce(products(500))
      .mockRejectedValueOnce(new Error('banco fora'));
    const { index } = mockIndex();

    await expect(reindexer(repository, index).run()).rejects.toThrow(
      'banco fora',
    );
    expect(index.swapAlias).not.toHaveBeenCalled();
    expect(index.deleteIndex).toHaveBeenCalledWith(NEW_INDEX);
  });

  it('falha ao apagar o índice antigo depois da troca → não desfaz nada, só avisa', async () => {
    const repository = mockRepository([products(3)]);
    const { index } = mockIndex();
    index.deleteIndex.mockRejectedValueOnce(new Error('ES ocupado'));

    await expect(reindexer(repository, index).run()).resolves.toBe(3);
    expect(index.deleteIndex).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('products_1000'));
  });
});
