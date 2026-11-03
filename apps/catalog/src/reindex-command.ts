import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CatalogModule } from './catalog.module';
import { Reindexer } from './search/reindexer';

export interface ReindexContext {
  get(type: typeof Reindexer): Reindexer;
  close(): Promise<void>;
}

// Contexto do Nest sem TCP, sem HTTP e sem consumidor: só os providers.
function createContext(): Promise<ReindexContext> {
  return NestFactory.createApplicationContext(CatalogModule);
}

// `node dist/main.js reindex`: reconstrói o índice de busca e devolve o
// código de saída. Sem o Elasticsearch configurado, falha antes de abrir
// conexão com qualquer coisa.
export async function runReindexCommand(
  env: NodeJS.ProcessEnv = process.env,
  create: () => Promise<ReindexContext> = createContext,
): Promise<number> {
  const logger = new Logger('Reindex');
  if (!env.CATALOG_ELASTICSEARCH_URL) {
    logger.error('CATALOG_ELASTICSEARCH_URL not set: nothing to reindex into');
    return 1;
  }
  const context = await create();
  try {
    const count = await context.get(Reindexer).run();
    logger.log(`Reindexed ${count} active products`);
    return 0;
  } catch (error) {
    logger.error(`Reindex failed: ${(error as Error).message}`);
    return 1;
  } finally {
    await context.close();
  }
}
