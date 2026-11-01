import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CATALOG_PATTERNS,
  type AddVariantData,
  type CatalogRequest,
  type CreateProductData,
  type ProductIdData,
  type ProductView,
  type UpdateProductData,
  type UpdateVariantData,
} from '@stockroute/contracts';
import { ProductsService } from './products.service';
import { CatalogRpcErrorFilter } from './rpc-error.filter';

// Entrada TCP do catálogo: cada mensagem do contrato vira um caso de uso.
// O dado já chega validado pelo gateway.
@Controller()
@UseFilters(CatalogRpcErrorFilter)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @MessagePattern(CATALOG_PATTERNS.create)
  create(
    @Payload() { actor, data }: CatalogRequest<CreateProductData>,
  ): Promise<ProductView> {
    return this.products.create(actor, data);
  }

  @MessagePattern(CATALOG_PATTERNS.update)
  update(
    @Payload() { actor, data }: CatalogRequest<UpdateProductData>,
  ): Promise<ProductView> {
    return this.products.update(actor, data);
  }

  // Sem corpo de resposta: o TCP do Nest precisa de um valor, então `null`.
  @MessagePattern(CATALOG_PATTERNS.deactivate)
  async deactivate(
    @Payload() { actor, data }: CatalogRequest<ProductIdData>,
  ): Promise<null> {
    await this.products.deactivate(actor, data);
    return null;
  }

  @MessagePattern(CATALOG_PATTERNS.addVariant)
  addVariant(
    @Payload() { actor, data }: CatalogRequest<AddVariantData>,
  ): Promise<ProductView> {
    return this.products.addVariant(actor, data);
  }

  @MessagePattern(CATALOG_PATTERNS.updateVariant)
  updateVariant(
    @Payload() { actor, data }: CatalogRequest<UpdateVariantData>,
  ): Promise<ProductView> {
    return this.products.updateVariant(actor, data);
  }

  @MessagePattern(CATALOG_PATTERNS.get)
  get(
    @Payload() { actor, data }: CatalogRequest<ProductIdData>,
  ): Promise<ProductView> {
    return this.products.get(actor, data);
  }
}
