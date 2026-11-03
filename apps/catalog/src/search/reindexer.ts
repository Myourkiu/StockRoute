import { Injectable, Logger } from '@nestjs/common';
import { ProductsRepository } from '../products/products.repository';
import { ProductIndex } from './product-index';

export const REINDEX_BATCH_SIZE = 500;

// Reconstrói o índice de busca a partir do banco, sem a busca sair do ar:
// 1. cria um índice novo, ao lado do atual;
// 2. preenche em lotes de 500, lidos do Postgres em ordem de id;
// 3. faz `refresh`, para tudo ficar visível de uma vez;
// 4. troca o alias numa operação atômica;
// 5. apaga os índices antigos.
// Até a troca, a busca usa o índice antigo. Se algo falhar antes dela, o
// índice novo é apagado e nada muda para quem busca.
//
// Limite conhecido: um evento indexado no índice antigo durante os lotes se
// perde na troca. Rodar a reindexação de novo corrige.
@Injectable()
export class Reindexer {
  private readonly logger = new Logger(Reindexer.name);

  constructor(
    private readonly repository: ProductsRepository,
    private readonly index: ProductIndex,
  ) {}

  async run(): Promise<number> {
    const target = await this.index.createIndex();
    let count: number;
    try {
      count = await this.fill(target);
      await this.index.refresh(target);
    } catch (error) {
      await this.index.deleteIndex(target).catch(() => undefined);
      throw error;
    }
    const old = await this.index.swapAlias(target);
    // Depois da troca, o índice novo já responde: uma falha aqui só deixa um
    // índice velho sobrando, e não pode desfazer nada.
    for (const name of old) {
      await this.index.deleteIndex(name).catch((error: Error) => {
        this.logger.warn(`Old index ${name} not deleted: ${error.message}`);
      });
    }
    return count;
  }

  private async fill(target: string): Promise<number> {
    let count = 0;
    let afterId: string | null = null;
    for (;;) {
      const page = await this.repository.findActivePage(
        afterId,
        REINDEX_BATCH_SIZE,
      );
      if (page.length === 0) {
        return count;
      }
      await this.index.bulkIndex(target, page);
      count += page.length;
      // Página incompleta é a última: não precisa de mais uma consulta.
      if (page.length < REINDEX_BATCH_SIZE) {
        return count;
      }
      afterId = page[page.length - 1].id;
    }
  }
}
