import { Injectable } from '@nestjs/common';
import type {
  Actor,
  AddVariantData,
  CreateProductData,
  ProductIdData,
  ProductView,
  UpdateProductData,
  UpdateVariantData,
} from '@stockroute/contracts';
import { ForbiddenActionError, ProductNotFoundError } from './product.errors';
import { ProductsRepository, type ProductRecord } from './products.repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SupplierActor = Extract<Actor, { role: 'supplier' }>;

// Casos de uso do catálogo. A posse é decidida aqui: produto de outro
// fornecedor responde igual a um inexistente, para não revelar que ele existe.
@Injectable()
export class ProductsService {
  constructor(private readonly repository: ProductsRepository) {}

  async create(actor: Actor, data: CreateProductData): Promise<ProductView> {
    const supplier = requireSupplier(actor);
    const created = await this.repository.create({
      ...data,
      supplierId: supplier.supplierId,
    });
    return toView(created);
  }

  async update(
    actor: Actor,
    { id, changes }: UpdateProductData,
  ): Promise<ProductView> {
    await this.findOwned(actor, id);
    return toView(await this.repository.update(id, changes));
  }

  // Idempotente: desativar um produto já inativo também é sucesso.
  async deactivate(actor: Actor, { id }: ProductIdData): Promise<void> {
    const product = await this.findOwned(actor, id);
    if (product.active) {
      await this.repository.setActive(id, false);
    }
  }

  async addVariant(
    actor: Actor,
    { id, variant }: AddVariantData,
  ): Promise<ProductView> {
    await this.findOwned(actor, id);
    return toView(await this.repository.addVariant(id, variant));
  }

  async updateVariant(
    actor: Actor,
    { id, sku, changes }: UpdateVariantData,
  ): Promise<ProductView> {
    await this.findOwned(actor, id);
    const updated = await this.repository.updateVariant(id, sku, changes);
    if (!updated) {
      throw new ProductNotFoundError(id);
    }
    return toView(updated);
  }

  // Inativo só existe para o dono, que precisa vê-lo para reativar.
  async get(actor: Actor, { id }: ProductIdData): Promise<ProductView> {
    const product = await this.find(id);
    if (!product.active && !isOwner(actor, product)) {
      throw new ProductNotFoundError(id);
    }
    return toView(product);
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
