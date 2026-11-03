import type { Actor, ProductView, VariantInput } from '@stockroute/contracts';
import type { ProductCache } from '../cache/product-cache';
import type { ProductEvents } from '../events/product-events';
import type { ProductIndex } from '../search/product-index';
import {
  ForbiddenActionError,
  ProductNotFoundError,
  SkuConflictError,
} from './product.errors';
import type { ProductRecord, ProductsRepository } from './products.repository';
import { ProductsService } from './products.service';

const SUPPLIER_A = '11111111-1111-4111-8111-111111111111';
const SUPPLIER_B = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';

const supplierA: Actor = { role: 'supplier', supplierId: SUPPLIER_A };
const supplierB: Actor = { role: 'supplier', supplierId: SUPPLIER_B };
const retailer: Actor = { role: 'retailer' };

const variant: VariantInput = {
  sku: 'SKU-1',
  attributes: { cor: 'azul' },
  wholesalePriceCents: 1990,
  minQuantity: 6,
  initialStock: 10,
};

function record(overrides: Partial<ProductRecord> = {}): ProductRecord {
  return {
    id: PRODUCT_ID,
    supplierId: SUPPLIER_A,
    name: 'Camiseta',
    description: 'Algodão',
    category: 'vestuario',
    tags: ['algodao'],
    active: true,
    createdAt: new Date('2026-10-30T12:00:00.000Z'),
    updatedAt: new Date('2026-10-30T12:00:00.000Z'),
    variants: [
      {
        sku: 'SKU-1',
        attributes: { cor: 'azul' },
        wholesalePriceCents: 1990,
        minQuantity: 6,
        available: 10,
      },
    ],
    ...overrides,
  };
}

type Repository = ProductsRepository;

// Funções soltas (e não métodos), para o lint não acusar método sem `this`.
function mockMethod<K extends keyof Repository>() {
  return jest.fn<ReturnType<Repository[K]>, Parameters<Repository[K]>>();
}

function mockRepository() {
  return {
    create: mockMethod<'create'>(),
    findById: mockMethod<'findById'>(),
    update: mockMethod<'update'>(),
    addVariant: mockMethod<'addVariant'>(),
    updateVariant: mockMethod<'updateVariant'>(),
    setActive: mockMethod<'setActive'>(),
  };
}

// Por padrão o cache está vazio (miss), e as regras se comportam como sem cache.
function mockCache() {
  return {
    get: jest
      .fn<ReturnType<ProductCache['get']>, Parameters<ProductCache['get']>>()
      .mockResolvedValue({ kind: 'miss' }),
    setProduct: jest.fn<
      ReturnType<ProductCache['setProduct']>,
      Parameters<ProductCache['setProduct']>
    >(),
    setNotFound: jest.fn<
      ReturnType<ProductCache['setNotFound']>,
      Parameters<ProductCache['setNotFound']>
    >(),
    invalidate: jest.fn<
      ReturnType<ProductCache['invalidate']>,
      Parameters<ProductCache['invalidate']>
    >(),
  };
}

function mockEvents() {
  return { publishUpserted: jest.fn<void, [string]>() };
}

function mockIndex() {
  return {
    search: jest.fn<
      ReturnType<ProductIndex['search']>,
      Parameters<ProductIndex['search']>
    >(),
  };
}

// Regras do catálogo (T03) com o repositório mockado: posse, visibilidade de
// produto inativo e desativação idempotente.
describe('ProductsService', () => {
  let repository: ReturnType<typeof mockRepository>;
  let cache: ReturnType<typeof mockCache>;
  let events: ReturnType<typeof mockEvents>;
  let index: ReturnType<typeof mockIndex>;
  let service: ProductsService;

  beforeEach(() => {
    repository = mockRepository();
    cache = mockCache();
    events = mockEvents();
    index = mockIndex();
    service = new ProductsService(
      repository as unknown as ProductsRepository,
      cache as unknown as ProductCache,
      events as unknown as ProductEvents,
      index as unknown as ProductIndex,
    );
  });

  describe('create', () => {
    it('grava com o fornecedor do ator e devolve a visão com datas ISO', async () => {
      repository.create.mockResolvedValue(record());

      const view = await service.create(supplierA, {
        name: 'Camiseta',
        description: 'Algodão',
        category: 'vestuario',
        tags: ['algodao'],
        variants: [variant],
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ supplierId: SUPPLIER_A }),
      );
      expect(view).toMatchObject({
        id: PRODUCT_ID,
        createdAt: '2026-10-30T12:00:00.000Z',
        variants: [{ sku: 'SKU-1', available: 10 }],
      });
    });

    it('lojista não cria: ForbiddenActionError, sem tocar o repositório', async () => {
      await expect(
        service.create(retailer, {
          name: 'X',
          description: '',
          category: 'c',
          tags: [],
          variants: [variant],
        }),
      ).rejects.toBeInstanceOf(ForbiddenActionError);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('SkuConflictError do repositório chega a quem chamou', async () => {
      repository.create.mockRejectedValue(new SkuConflictError());

      await expect(
        service.create(supplierA, {
          name: 'X',
          description: '',
          category: 'c',
          tags: [],
          variants: [variant],
        }),
      ).rejects.toBeInstanceOf(SkuConflictError);
    });
  });

  describe('escritas sobre produto existente', () => {
    it('editar produto de outro fornecedor responde como inexistente, sem escrever', async () => {
      repository.findById.mockResolvedValue(record());

      await expect(
        service.update(supplierB, { id: PRODUCT_ID, changes: { name: 'Y' } }),
      ).rejects.toBeInstanceOf(ProductNotFoundError);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('desativar produto de outro fornecedor responde como inexistente, sem escrever', async () => {
      repository.findById.mockResolvedValue(record());

      await expect(
        service.deactivate(supplierB, { id: PRODUCT_ID }),
      ).rejects.toBeInstanceOf(ProductNotFoundError);
      expect(repository.setActive).not.toHaveBeenCalled();
    });

    it('editar produto inexistente lança ProductNotFoundError', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.update(supplierA, { id: PRODUCT_ID, changes: { name: 'Y' } }),
      ).rejects.toBeInstanceOf(ProductNotFoundError);
    });

    it('id que não é UUID responde como inexistente, sem consultar o banco', async () => {
      await expect(
        service.update(supplierA, { id: 'nao-e-uuid', changes: {} }),
      ).rejects.toBeInstanceOf(ProductNotFoundError);
      expect(repository.findById).not.toHaveBeenCalled();
    });

    it('lojista não edita: ForbiddenActionError', async () => {
      await expect(
        service.update(retailer, { id: PRODUCT_ID, changes: { name: 'Y' } }),
      ).rejects.toBeInstanceOf(ForbiddenActionError);
    });

    it('desativar produto já inativo responde sucesso', async () => {
      repository.findById.mockResolvedValue(record({ active: false }));

      await expect(
        service.deactivate(supplierA, { id: PRODUCT_ID }),
      ).resolves.toBeUndefined();
      expect(repository.setActive).not.toHaveBeenCalled();
    });

    it('desativar produto ativo do dono chama setActive(false)', async () => {
      repository.findById.mockResolvedValue(record());

      await expect(
        service.deactivate(supplierA, { id: PRODUCT_ID }),
      ).resolves.toBeUndefined();
      expect(repository.setActive).toHaveBeenCalledWith(PRODUCT_ID, false);
    });

    it('editar com active: true reativa o produto inativo do dono', async () => {
      repository.findById.mockResolvedValue(record({ active: false }));
      repository.update.mockResolvedValue(record({ active: true }));

      const view = await service.update(supplierA, {
        id: PRODUCT_ID,
        changes: { active: true },
      });

      expect(repository.update).toHaveBeenCalledWith(PRODUCT_ID, {
        active: true,
      });
      expect(view.active).toBe(true);
    });

    it('addVariant no produto do dono devolve o produto com a variante', async () => {
      repository.findById.mockResolvedValue(record());
      repository.addVariant.mockResolvedValue(record());

      await service.addVariant(supplierA, { id: PRODUCT_ID, variant });

      expect(repository.addVariant).toHaveBeenCalledWith(PRODUCT_ID, variant);
    });

    it('updateVariant de SKU que não é do produto lança ProductNotFoundError', async () => {
      repository.findById.mockResolvedValue(record());
      repository.updateVariant.mockResolvedValue(null);

      await expect(
        service.updateVariant(supplierA, {
          id: PRODUCT_ID,
          sku: 'SKU-OUTRO',
          changes: { minQuantity: 2 },
        }),
      ).rejects.toBeInstanceOf(ProductNotFoundError);
    });
  });

  describe('get', () => {
    it('produto ativo é visível para qualquer ator', async () => {
      repository.findById.mockResolvedValue(record());

      await expect(
        service.get(retailer, { id: PRODUCT_ID }),
      ).resolves.toMatchObject({ id: PRODUCT_ID, active: true });
    });

    it('produto inativo é visível para o dono, com active: false', async () => {
      repository.findById.mockResolvedValue(record({ active: false }));

      await expect(
        service.get(supplierA, { id: PRODUCT_ID }),
      ).resolves.toMatchObject({ active: false });
    });

    it.each([
      ['lojista', retailer],
      ['outro fornecedor', supplierB],
    ])(
      'produto inativo é inexistente para %s',
      async (_label, actor: Actor) => {
        repository.findById.mockResolvedValue(record({ active: false }));

        await expect(
          service.get(actor, { id: PRODUCT_ID }),
        ).rejects.toBeInstanceOf(ProductNotFoundError);
      },
    );

    it('produto inexistente lança ProductNotFoundError', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.get(retailer, { id: PRODUCT_ID }),
      ).rejects.toBeInstanceOf(ProductNotFoundError);
    });
  });

  // Cache-aside da leitura (T09): o cache guarda só a visão pública (produto
  // ativo) e o "não existe"; as escritas invalidam depois de gravar.
  describe('cache-aside', () => {
    const cached: ProductView = {
      ...record(),
      createdAt: '2026-10-30T12:00:00.000Z',
      updatedAt: '2026-10-30T12:00:00.000Z',
    };

    it('hit → devolve do cache sem chamar o repositório', async () => {
      cache.get.mockResolvedValue({ kind: 'hit', product: cached });

      await expect(service.get(retailer, { id: PRODUCT_ID })).resolves.toEqual(
        cached,
      );
      expect(repository.findById).not.toHaveBeenCalled();
    });

    it('miss com produto ativo → busca no repositório e grava no cache', async () => {
      repository.findById.mockResolvedValue(record());

      const view = await service.get(retailer, { id: PRODUCT_ID });

      expect(cache.setProduct).toHaveBeenCalledWith(view);
    });

    it.each([
      ['inexistente', null],
      ['inativo', record({ active: false })],
    ])(
      'miss com produto %s para quem não é dono → grava o "não existe"',
      async (_label, found) => {
        repository.findById.mockResolvedValue(found);

        await expect(
          service.get(retailer, { id: PRODUCT_ID }),
        ).rejects.toBeInstanceOf(ProductNotFoundError);
        expect(cache.setNotFound).toHaveBeenCalledWith(PRODUCT_ID);
        expect(cache.setProduct).not.toHaveBeenCalled();
      },
    );

    it('"não existe" em cache para lojista → 404 sem chamar o repositório', async () => {
      cache.get.mockResolvedValue({ kind: 'notFound' });

      await expect(
        service.get(retailer, { id: PRODUCT_ID }),
      ).rejects.toBeInstanceOf(ProductNotFoundError);
      expect(repository.findById).not.toHaveBeenCalled();
    });

    it('"não existe" em cache para fornecedor → vai ao repositório, porque ele pode ser o dono de um inativo', async () => {
      cache.get.mockResolvedValue({ kind: 'notFound' });
      repository.findById.mockResolvedValue(record({ active: false }));

      await expect(
        service.get(supplierA, { id: PRODUCT_ID }),
      ).resolves.toMatchObject({ active: false });
    });

    it('dono lendo o próprio produto inativo → não grava nada no cache', async () => {
      repository.findById.mockResolvedValue(record({ active: false }));

      await service.get(supplierA, { id: PRODUCT_ID });

      expect(cache.setProduct).not.toHaveBeenCalled();
      expect(cache.setNotFound).not.toHaveBeenCalled();
    });

    it('id que não é UUID → 404 sem tocar o cache', async () => {
      await expect(
        service.get(retailer, { id: 'nao-e-uuid' }),
      ).rejects.toBeInstanceOf(ProductNotFoundError);
      expect(cache.get).not.toHaveBeenCalled();
      expect(cache.setNotFound).not.toHaveBeenCalled();
    });

    it.each([
      [
        'editar',
        (s: ProductsService) =>
          s.update(supplierA, { id: PRODUCT_ID, changes: { name: 'Y' } }),
      ],
      [
        'reativar',
        (s: ProductsService) =>
          s.update(supplierA, { id: PRODUCT_ID, changes: { active: true } }),
      ],
      [
        'adicionar variante',
        (s: ProductsService) =>
          s.addVariant(supplierA, { id: PRODUCT_ID, variant }),
      ],
      [
        'editar variante',
        (s: ProductsService) =>
          s.updateVariant(supplierA, {
            id: PRODUCT_ID,
            sku: 'SKU-1',
            changes: { minQuantity: 2 },
          }),
      ],
      [
        'desativar',
        (s: ProductsService) => s.deactivate(supplierA, { id: PRODUCT_ID }),
      ],
    ])('%s com sucesso → invalida depois da escrita', async (_label, write) => {
      repository.findById.mockResolvedValue(record());
      const order: string[] = [];
      repository.update.mockImplementation(async () => {
        order.push('write');
        return record();
      });
      repository.addVariant.mockImplementation(async () => {
        order.push('write');
        return record();
      });
      repository.updateVariant.mockImplementation(async () => {
        order.push('write');
        return record();
      });
      repository.setActive.mockImplementation(async () => {
        order.push('write');
      });
      cache.invalidate.mockImplementation(async () => {
        order.push('invalidate');
      });

      await write(service);

      expect(cache.invalidate).toHaveBeenCalledWith(PRODUCT_ID);
      expect(order).toEqual(['write', 'invalidate']);
    });

    it.each([
      ['NotFound', null, undefined, ProductNotFoundError],
      ['Conflict', record(), new SkuConflictError(), SkuConflictError],
    ])(
      'escrita que falha (%s) → não invalida',
      async (_label, found, error, expectedError) => {
        repository.findById.mockResolvedValue(found);
        if (error) {
          repository.addVariant.mockRejectedValue(error);
        }

        await expect(
          service.addVariant(supplierA, { id: PRODUCT_ID, variant }),
        ).rejects.toBeInstanceOf(expectedError);
        expect(cache.invalidate).not.toHaveBeenCalled();
      },
    );
  });

  // Evento de produto alterado (fatia 3, T03): publicado depois de cada
  // escrita com sucesso, e só depois de invalidar o cache. Escrita que falha
  // não publica nada.
  describe('publicação do evento', () => {
    it('criar com sucesso → publica o id do produto criado', async () => {
      repository.create.mockResolvedValue(record());

      await service.create(supplierA, {
        name: 'Camiseta',
        description: 'Algodão',
        category: 'vestuario',
        tags: [],
        variants: [variant],
      });

      expect(events.publishUpserted).toHaveBeenCalledWith(PRODUCT_ID);
    });

    it.each([
      [
        'editar',
        (s: ProductsService) =>
          s.update(supplierA, { id: PRODUCT_ID, changes: { name: 'Y' } }),
      ],
      [
        'reativar',
        (s: ProductsService) =>
          s.update(supplierA, { id: PRODUCT_ID, changes: { active: true } }),
      ],
      [
        'adicionar variante',
        (s: ProductsService) =>
          s.addVariant(supplierA, { id: PRODUCT_ID, variant }),
      ],
      [
        'editar variante',
        (s: ProductsService) =>
          s.updateVariant(supplierA, {
            id: PRODUCT_ID,
            sku: 'SKU-1',
            changes: { minQuantity: 2 },
          }),
      ],
      [
        'desativar',
        (s: ProductsService) => s.deactivate(supplierA, { id: PRODUCT_ID }),
      ],
    ])(
      '%s com sucesso → publica depois de invalidar',
      async (_label, write) => {
        repository.findById.mockResolvedValue(record());
        repository.update.mockResolvedValue(record());
        repository.addVariant.mockResolvedValue(record());
        repository.updateVariant.mockResolvedValue(record());
        const order: string[] = [];
        cache.invalidate.mockImplementation(async () => {
          order.push('invalidate');
        });
        events.publishUpserted.mockImplementation(() => {
          order.push('publish');
        });

        await write(service);

        expect(events.publishUpserted).toHaveBeenCalledWith(PRODUCT_ID);
        expect(order).toEqual(['invalidate', 'publish']);
      },
    );

    it.each([
      [
        'NotFound',
        (s: ProductsService) =>
          s.update(supplierA, { id: PRODUCT_ID, changes: { name: 'Y' } }),
        () => undefined,
      ],
      [
        'Conflict',
        (s: ProductsService) =>
          s.addVariant(supplierA, { id: PRODUCT_ID, variant }),
        (repository: ReturnType<typeof mockRepository>) => {
          repository.findById.mockResolvedValue(record());
          repository.addVariant.mockRejectedValue(new SkuConflictError());
        },
      ],
      [
        'Forbidden',
        (s: ProductsService) =>
          s.create(retailer, {
            name: 'Camiseta',
            description: 'Algodão',
            category: 'vestuario',
            tags: [],
            variants: [variant],
          }),
        () => undefined,
      ],
    ])(
      'escrita que falha (%s) → não publica',
      async (_label, write, arrange) => {
        repository.findById.mockResolvedValue(null);
        arrange(repository);

        await expect(write(service)).rejects.toThrow();
        expect(events.publishUpserted).not.toHaveBeenCalled();
      },
    );
  });

  // Busca (fatia 3, T04): a mesma para qualquer papel, direto no índice.
  it('search devolve a página do índice para os filtros recebidos', async () => {
    const page = { items: [], nextCursor: null };
    index.search.mockResolvedValue(page);

    await expect(service.search({ q: 'camiseta' })).resolves.toBe(page);
    expect(index.search).toHaveBeenCalledWith({ q: 'camiseta' });
  });
});
