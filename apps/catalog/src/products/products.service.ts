import { Injectable } from '@nestjs/common';
import type {
  Actor,
  AddVariantData,
  CreateProductData,
  ProductIdData,
  ProductSearchPage,
  ProductView,
  SearchProductsData,
  UpdateProductData,
  UpdateVariantData,
} from '@stockroute/contracts';
import { ProductCache } from '../cache/product-cache';
import { ProductEvents } from '../events/product-events';
import { ProductIndex } from '../search/product-index';
import { ForbiddenActionError, ProductNotFoundError } from './product.errors';
import { ProductsRepository, type ProductRecord } from './products.repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SupplierActor = Extract<Actor, { role: 'supplier' }>;

// Casos de uso do catálogo. A posse é decidida aqui: produto de outro
// fornecedor responde igual a um inexistente, para não revelar que ele existe.
// A leitura usa cache-aside. Toda escrita, depois de gravar, invalida a chave
// e publica o evento que atualiza a busca.
@Injectable()
export class ProductsService {
  constructor(
    private readonly repository: ProductsRepository,
    private readonly cache: ProductCache,
    private readonly events: ProductEvents,
    private readonly index: ProductIndex,
  ) {}

  async create(actor: Actor, data: CreateProductData): Promise<ProductView> {
    const supplier = requireSupplier(actor);
    const created = await this.repository.create({
      ...data,
      supplierId: supplier.supplierId,
    });
    this.events.publishUpserted(created.id);
    return toView(created);
  }

  async update(
    actor: Actor,
    { id, changes }: UpdateProductData,
  ): Promise<ProductView> {
    await this.findOwned(actor, id);
    const updated = await this.afterWrite(id, () =>
      this.repository.update(id, changes),
    );
    return toView(updated);
  }

  // Idempotente: desativar um produto já inativo também é sucesso.
  async deactivate(actor: Actor, { id }: ProductIdData): Promise<void> {
    const product = await this.findOwned(actor, id);
    await this.afterWrite(id, async () => {
      if (product.active) {
        await this.repository.setActive(id, false);
      }
    });
  }

  async addVariant(
    actor: Actor,
    { id, variant }: AddVariantData,
  ): Promise<ProductView> {
    await this.findOwned(actor, id);
    const updated = await this.afterWrite(id, () =>
      this.repository.addVariant(id, variant),
    );
    return toView(updated);
  }

  async updateVariant(
    actor: Actor,
    { id, sku, changes }: UpdateVariantData,
  ): Promise<ProductView> {
    await this.findOwned(actor, id);
    const updated = await this.afterWrite(id, async () => {
      const result = await this.repository.updateVariant(id, sku, changes);
      if (!result) {
        throw new ProductNotFoundError(id);
      }
      return result;
    });
    return toView(updated);
  }

  // Inativo só existe para o dono, que precisa vê-lo para reativar. O cache
  // guarda só a visão pública: o produto ativo ou o "não existe".
  async get(actor: Actor, { id }: ProductIdData): Promise<ProductView> {
    if (!UUID.test(id)) {
      throw new ProductNotFoundError(id);
    }
    const cached = await this.cache.get(id);
    if (cached.kind === 'hit') {
      return cached.product;
    }
    // "Não existe" vale para lojistas; um fornecedor pode ser o dono de um
    // produto inativo, então ele segue para o banco.
    if (cached.kind === 'notFound' && actor.role !== 'supplier') {
      throw new ProductNotFoundError(id);
    }
    const product = await this.repository.findById(id);
    if (product?.active) {
      const view = toView(product);
      await this.cache.setProduct(view);
      return view;
    }
    if (product && isOwner(actor, product)) {
      return toView(product);
    }
    if (cached.kind === 'miss') {
      await this.cache.setNotFound(id);
    }
    throw new ProductNotFoundError(id);
  }

  // A busca é igual para qualquer papel: o índice só tem produtos ativos.
  search(filters: SearchProductsData): Promise<ProductSearchPage> {
    return this.index.search(filters);
  }

  // Invalida e publica só depois que a escrita deu certo; se ela falhar, o
  // cache e o índice ficam como estão.
  private async afterWrite<T>(id: string, write: () => Promise<T>) {
    const result = await write();
    await this.cache.invalidate(id);
    this.events.publishUpserted(id);
    return result;
  }

  private async find(id: string): Promise<ProductRecord> {
    const product = UUID.test(id) ? await this.repository.findById(id) : null;
    if (!product) {
      throw new ProductNotFoundError(id);
    }
    return product;
  }

  private async findOwned(actor: Actor, id: string): Promise<ProductRecord> {
    requireSupplier(actor);
    const product = await this.find(id);
    if (!isOwner(actor, product)) {
      throw new ProductNotFoundError(id);
    }
    return product;
  }
}

function requireSupplier(actor: Actor): SupplierActor {
  if (actor.role !== 'supplier') {
    throw new ForbiddenActionError();
  }
  return actor;
}

function isOwner(actor: Actor, product: ProductRecord): boolean {
  return actor.role === 'supplier' && actor.supplierId === product.supplierId;
}

function toView(product: ProductRecord): ProductView {
  return {
    ...product,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}
