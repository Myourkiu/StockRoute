import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { SkuConflictError } from '../../apps/catalog/src/products/product.errors';
import {
  ProductsRepository,
  type NewProduct,
} from '../../apps/catalog/src/products/products.repository';
import { PrismaService } from '../../apps/catalog/src/prisma/prisma.service';
import { SUPPLIER_ALFA } from '../fixtures/suppliers';
import { connectionUrl, startPostgres } from './postgres-container';
import { migrateDeploy } from './prisma-migrate';

// Repositório do catalog contra o Postgres real (T02): a transação da criação,
// a unicidade do SKU e o estoque que a edição não toca.
describe('ProductsRepository (integração)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaService;
  let repository: ProductsRepository;
  let skuSeq = 0;

  function sku() {
    skuSeq += 1;
    // Com zeros à esquerda, a ordem por SKU segue a ordem de criação.
    return `SKU-${String(skuSeq).padStart(4, '0')}`;
  }

  function newProduct(overrides: Partial<NewProduct> = {}): NewProduct {
    return {
      supplierId: SUPPLIER_ALFA,
      name: 'Camiseta básica',
      description: 'Algodão penteado',
      category: 'vestuario',
      tags: ['algodao', 'basica'],
      variants: [
        {
          sku: sku(),
          attributes: { cor: 'azul', tamanho: 'M' },
          wholesalePriceCents: 1990,
          minQuantity: 6,
          initialStock: 10,
        },
        {
          sku: sku(),
          attributes: { cor: 'preta', tamanho: 'G' },
          wholesalePriceCents: 2190,
          minQuantity: 6,
          initialStock: 0,
        },
      ],
      ...overrides,
    };
  }

  async function countRows() {
    const [products, variants, stock] = await Promise.all([
      prisma.product.count(),
      prisma.variant.count(),
      prisma.stock.count(),
    ]);
    return { products, variants, stock };
  }

  beforeAll(async () => {
    container = await startPostgres();
    const url = connectionUrl(container, 'catalog_svc', 'catalog');
    await migrateDeploy('catalog', url);
    process.env.CATALOG_DATABASE_URL = url;
    prisma = new PrismaService();
    repository = new ProductsRepository(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container.stop();
    delete process.env.CATALOG_DATABASE_URL;
  });

  it('create grava produto ativo, variantes e estoque inicial, e findById traz tudo', async () => {
    const input = newProduct();

    const created = await repository.create(input);
    const found = await repository.findById(created.id);

    expect(found).toEqual(created);
    expect(found).toMatchObject({
      supplierId: SUPPLIER_ALFA,
      name: 'Camiseta básica',
      tags: ['algodao', 'basica'],
      active: true,
    });
    expect(
      found?.variants.map((v) => [v.sku, v.available, v.attributes]),
    ).toEqual([
      [input.variants[0].sku, 10, { cor: 'azul', tamanho: 'M' }],
      [input.variants[1].sku, 0, { cor: 'preta', tamanho: 'G' }],
    ]);
  });

  it('create com SKU de outro produto lança SkuConflictError e não grava nada', async () => {
    const existing = await repository.create(newProduct());
    const before = await countRows();
    const input = newProduct();
    input.variants[1].sku = existing.variants[0].sku;

    await expect(repository.create(input)).rejects.toBeInstanceOf(
      SkuConflictError,
    );
    expect(await countRows()).toEqual(before);
  });

  it('create com o mesmo SKU duas vezes no payload lança SkuConflictError e não grava nada', async () => {
    const before = await countRows();
    const input = newProduct();
    input.variants[1].sku = input.variants[0].sku;

    await expect(repository.create(input)).rejects.toBeInstanceOf(
      SkuConflictError,
    );
    expect(await countRows()).toEqual(before);
  });

  it('addVariant cria variante e estoque; com SKU existente lança SkuConflictError', async () => {
    const product = await repository.create(newProduct());
    const variant = {
      sku: sku(),
      attributes: { cor: 'verde' },
      wholesalePriceCents: 2500,
      minQuantity: 12,
      initialStock: 5,
    };

    const updated = await repository.addVariant(product.id, variant);

    expect(updated.variants.at(-1)).toMatchObject({
      sku: variant.sku,
      available: 5,
    });
    await expect(
      repository.addVariant(product.id, {
        ...variant,
        sku: product.variants[0].sku,
      }),
    ).rejects.toBeInstanceOf(SkuConflictError);
  });

  it('update e updateVariant mudam os campos e não mexem no estoque', async () => {
    const product = await repository.create(newProduct());
    const target = product.variants[0];

    await repository.update(product.id, { name: 'Camiseta premium' });
    const updated = await repository.updateVariant(product.id, target.sku, {
      wholesalePriceCents: 2490,
    });

    expect(updated?.name).toBe('Camiseta premium');
    expect(updated?.variants[0]).toMatchObject({
      sku: target.sku,
      wholesalePriceCents: 2490,
      available: target.available,
    });
  });

  it('updateVariant de SKU que não é do produto devolve null', async () => {
    const a = await repository.create(newProduct());
    const b = await repository.create(newProduct());

    await expect(
      repository.updateVariant(a.id, b.variants[0].sku, { minQuantity: 2 }),
    ).resolves.toBeNull();
  });

  it('findById de UUID inexistente devolve null', async () => {
    await expect(
      repository.findById('00000000-0000-4000-8000-000000000000'),
    ).resolves.toBeNull();
  });

  it('setActive(false) duas vezes não falha e o produto continua no banco', async () => {
    const product = await repository.create(newProduct());

    await repository.setActive(product.id, false);
    await repository.setActive(product.id, false);

    await expect(repository.findById(product.id)).resolves.toMatchObject({
      id: product.id,
      active: false,
    });
  });
});
