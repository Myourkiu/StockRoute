import type { Actor, VariantInput } from '@stockroute/contracts';
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

// Regras do catálogo (T03) com o repositório mockado: posse, visibilidade de
// produto inativo e desativação idempotente.
describe('ProductsService', () => {
  let repository: ReturnType<typeof mockRepository>;
  let service: ProductsService;

  beforeEach(() => {
    repository = mockRepository();
    service = new ProductsService(repository as unknown as ProductsRepository);
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
});
