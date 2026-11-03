import { Injectable, Logger } from '@nestjs/common';
import { ProductsRepository } from '../products/products.repository';
import { ProductIndex } from '../search/product-index';

// Mantém o índice de busca igual ao banco, produto a produto. O evento só diz
// qual produto mudou; o estado vem sempre do banco, então eventos repetidos ou
// fora de ordem dão o mesmo resultado.
@Injectable()
export class ProductIndexer {
  private readonly logger = new Logger(ProductIndexer.name);

  constructor(
    private readonly repository: ProductsRepository,
    private readonly index: ProductIndex,
  ) {}

  // Nunca lança: uma falha vira log, e a reindexação corrige o índice.
  async sync(productId: string): Promise<void> {
    try {
      const product = await this.repository.findById(productId);
      if (product?.active) {
        await this.index.upsert(product);
      } else {
        await this.index.remove(productId);
      }
    } catch (error) {
      this.logger.error(
        `Indexing product ${productId} failed: ${(error as Error).message}`,
      );
    }
  }
}
