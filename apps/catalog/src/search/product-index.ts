import { Client, errors } from '@elastic/elasticsearch';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ProductSearchItem } from '@stockroute/contracts';
import type { ProductRecord } from '../products/products.repository';
import { ELASTICSEARCH } from './elasticsearch.provider';
import {
  PRODUCT_INDEX_MAPPINGS,
  PRODUCT_INDEX_SETTINGS,
  PRODUCTS_ALIAS,
  PRODUCTS_INDEX_PREFIX,
  type ProductDocument,
} from './product-index.mapping';
import type { SortValues } from './search-cursor';
import {
  buildSearchRequest,
  DEFAULT_LIMIT,
  type SearchPage,
  type SearchParams,
  toSearchPage,
} from './search-query';
import { SearchUnavailableError } from './search.errors';

// O índice de busca é uma projeção do Postgres: só produtos ativos, com o que
// a busca precisa. Pode ser apagado e reconstruído a qualquer momento.
@Injectable()
export class ProductIndex {
  private readonly logger = new Logger(ProductIndex.name);
  private ensured: Promise<void> | null = null;

  constructor(@Inject(ELASTICSEARCH) private readonly client: Client | null) {}

  // Cria o índice e o alias quando o alias não existe. Depois de dar certo,
  // não consulta o ES de novo; se falhar (ES fora), a próxima chamada tenta.
  ensure(): Promise<void> {
    if (!this.client) {
      return Promise.resolve();
    }
    this.ensured ??= this.createIfMissing(this.client).catch(
      (error: unknown) => {
        this.ensured = null;
        throw error;
      },
    );
    return this.ensured;
  }

  // Grava sempre pelo alias, depois do `ensure`: sem ele, o ES criaria sozinho
  // um índice chamado "products", com mapping adivinhado, no lugar do alias.
  async upsert(product: ProductRecord): Promise<void> {
    if (!this.client) {
      return;
    }
    await this.ensure();
    await this.client.index({
      index: PRODUCTS_ALIAS,
      id: product.id,
      document: toDocument(product),
    });
  }

  async remove(id: string): Promise<void> {
    if (!this.client) {
      return;
    }
    await this.client.delete({ index: PRODUCTS_ALIAS, id }, { ignore: [404] });
  }

  // Operações da reindexação. Ao contrário da busca e do indexador, exigem o
  // ES configurado: reindexar sem ele é erro, e não "nada a fazer".

  // Índice novo, sem alias: a busca só passa a usá-lo na troca do alias.
  async createIndex(): Promise<string> {
    const name = `${PRODUCTS_INDEX_PREFIX}${Date.now()}`;
    await this.requireClient().indices.create({
      index: name,
      settings: PRODUCT_INDEX_SETTINGS,
      mappings: PRODUCT_INDEX_MAPPINGS,
    });
    return name;
  }

  // Um item rejeitado no bulk não faz o pedido falhar: o ES responde 200 com
  // `errors: true`. Aqui ele vira erro, para a reindexação não trocar o alias
  // para um índice incompleto.
  async bulkIndex(index: string, products: ProductRecord[]): Promise<void> {
    const response = await this.requireClient().bulk({
      operations: products.flatMap((product) => [
        { index: { _index: index, _id: product.id } },
        toDocument(product),
      ]),
    });
    if (response.errors) {
      const failed = response.items.find((item) => item.index?.error);
      throw new Error(
        `Bulk indexing failed: ${failed?.index?.error?.reason ?? 'unknown error'}`,
      );
    }
  }

  async refresh(index: string): Promise<void> {
    await this.requireClient().indices.refresh({ index });
  }

  // Tira o alias dos índices atuais e o põe no novo numa única operação: a
  // busca passa de um para o outro sem nenhum instante sem índice. Devolve os
  // índices que perderam o alias.
  async swapAlias(index: string): Promise<string[]> {
    const client = this.requireClient();
    const current = await client.indices.getAlias(
      { name: PRODUCTS_ALIAS },
      { ignore: [404] },
    );
    const old = Object.keys(current).filter(
      (name) => name.startsWith(PRODUCTS_INDEX_PREFIX) && name !== index,
    );
    await client.indices.updateAliases({
      actions: [
        ...old.map((name) => ({
          remove: { index: name, alias: PRODUCTS_ALIAS },
        })),
        {
          add: { index, alias: PRODUCTS_ALIAS, is_write_index: true },
        },
      ],
    });
    return old;
  }

  async deleteIndex(index: string): Promise<void> {
    await this.requireClient().indices.delete({ index }, { ignore: [404] });
  }

  // O cursor é validado antes de chamar o ES: cursor inválido é erro do
  // cliente (400), não indisponibilidade (503).
  async search(params: SearchParams): Promise<SearchPage<ProductSearchItem>> {
    if (!this.client) {
      throw new SearchUnavailableError();
    }
    const request = buildSearchRequest(params);
    try {
      const response = await this.client.search<ProductSearchItem>({
        index: PRODUCTS_ALIAS,
        ...request,
      });
      const hits = response.hits.hits.map((hit) => ({
        _source: hit._source!,
        sort: hit.sort as SortValues,
      }));
      return toSearchPage(hits, params.limit ?? DEFAULT_LIMIT);
    } catch (error) {
      // Sem alias, nada foi indexado ainda: a busca está vazia, não fora.
      if (error instanceof errors.ResponseError && error.statusCode === 404) {
        return { items: [], nextCursor: null };
      }
      this.logger.warn(`Search failed: ${(error as Error).message}`);
      throw new SearchUnavailableError(error);
    }
  }

  // Duas instâncias do catalog podem passar juntas pelo `existsAlias`. O alias
  // aceita um único write index, então a segunda criação é recusada e o índice
  // dela não nasce; quem perdeu a corrida encontra o alias da outra e segue.
  private requireClient(): Client {
    if (!this.client) {
      throw new SearchUnavailableError();
    }
    return this.client;
  }

  private async createIfMissing(client: Client): Promise<void> {
    if (await client.indices.existsAlias({ name: PRODUCTS_ALIAS })) {
      return;
    }
    try {
      await client.indices.create({
        index: `${PRODUCTS_INDEX_PREFIX}${Date.now()}`,
        aliases: { [PRODUCTS_ALIAS]: { is_write_index: true } },
        settings: PRODUCT_INDEX_SETTINGS,
        mappings: PRODUCT_INDEX_MAPPINGS,
      });
    } catch (error) {
      if (await client.indices.existsAlias({ name: PRODUCTS_ALIAS })) {
        return;
      }
      throw error;
    }
  }
}

export function toDocument(product: ProductRecord): ProductDocument {
  const prices = product.variants.map((variant) => variant.wholesalePriceCents);
  return {
    id: product.id,
    supplierId: product.supplierId,
    name: product.name,
    description: product.description,
    category: product.category,
    tags: product.tags,
    variantPricesCents: prices,
    minPriceCents: Math.min(...prices),
    maxPriceCents: Math.max(...prices),
  };
}
