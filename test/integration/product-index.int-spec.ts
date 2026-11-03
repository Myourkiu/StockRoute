import { Client } from '@elastic/elasticsearch';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { StartedTestContainer } from 'testcontainers';
import { createElasticsearchClient } from '../../apps/catalog/src/search/elasticsearch.provider';
import { ProductIndex } from '../../apps/catalog/src/search/product-index';
import { SearchUnavailableError } from '../../apps/catalog/src/search/search.errors';
import type { ProductRecord } from '../../apps/catalog/src/products/products.repository';
import { SUPPLIER_ALFA } from '../fixtures/suppliers';
import { pause, unpause } from './docker';
import {
  elasticsearchUrl,
  startElasticsearch,
} from './elasticsearch-container';

let sequence = 0;

function product(
  fields: Partial<ProductRecord> = {},
  prices = [1000],
): ProductRecord {
  sequence += 1;
  return {
    id: randomUUID(),
    supplierId: SUPPLIER_ALFA,
    name: `Produto ${sequence}`,
    description: 'Descrição do produto',
    category: 'vestuario',
    tags: [],
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    variants: prices.map((price, i) => ({
      sku: `SKU-${sequence}-${i}`,
      attributes: {},
      wholesalePriceCents: price,
      minQuantity: 1,
      available: 10,
    })),
    ...fields,
  };
}

// Índice de produtos com o Elasticsearch real (T02): alias, analyzer
// `brazilian`, filtro de preço sobre o array das variantes, paginação com
// `search_after` e falha rápida com o ES travado.
describe('ProductIndex (Elasticsearch real)', () => {
  let container: StartedTestContainer;
  let admin: Client;
  let client: Client;
  let index: ProductIndex;

  async function productIndices(): Promise<string[]> {
    const indices = await admin.indices.get({
      index: 'products_*',
      allow_no_indices: true,
      ignore_unavailable: true,
    });
    return Object.keys(indices);
  }

  // O ES recusa apagar por curinga (`action.destructive_requires_name`), então
  // os índices são apagados pelo nome.
  async function deleteProductIndices() {
    for (const name of await productIndices()) {
      await admin.indices.delete({ index: name });
    }
  }

  async function seed(...products: ProductRecord[]) {
    for (const item of products) {
      await index.upsert(item);
    }
    await admin.indices.refresh({ index: 'products' });
  }

  async function ids(params: Parameters<ProductIndex['search']>[0]) {
    const page = await index.search(params);
    return page.items.map((item) => item.id);
  }

  async function allPages(params: Parameters<ProductIndex['search']>[0]) {
    const pages: string[][] = [];
    let cursor: string | undefined;
    do {
      const page = await index.search({ ...params, cursor });
      pages.push(page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return pages;
  }

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    container = await startElasticsearch();
    admin = new Client({ node: elasticsearchUrl(container) });
    client = createElasticsearchClient(elasticsearchUrl(container))!;
  }, 180_000);

  afterAll(async () => {
    await client?.close();
    await admin?.close();
    await container?.stop();
  });

  beforeEach(async () => {
    await deleteProductIndices();
    index = new ProductIndex(client);
  });

  it('alias inexistente (ensure não rodou) → página vazia', async () => {
    await expect(index.search({})).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it('ensure num ES vazio cria um products_* com o alias; de novo, não cria outro', async () => {
    await index.ensure();
    await new ProductIndex(client).ensure();

    const indices = await productIndices();
    expect(indices).toHaveLength(1);
    const alias = await admin.indices.getAlias({ name: 'products' });
    expect(Object.keys(alias)).toEqual(indices);
    const mapping = await admin.indices.getMapping({ index: 'products' });
    expect(mapping[indices[0]].mappings.properties?.name).toMatchObject({
      type: 'text',
      analyzer: 'brazilian',
    });
  });

  it('duas instâncias criando o índice ao mesmo tempo → um único products_*, sem erro em nenhuma', async () => {
    const results = await Promise.allSettled([
      new ProductIndex(
        createElasticsearchClient(elasticsearchUrl(container))!,
      ).ensure(),
      new ProductIndex(
        createElasticsearchClient(elasticsearchUrl(container))!,
      ).ensure(),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
    ]);
    expect(await productIndices()).toHaveLength(1);
  });

  it('upsert sem ensure antes cria o índice pelo alias, e não um índice "products"', async () => {
    await seed(product());

    expect(await productIndices()).toHaveLength(1);
    await expect(admin.indices.existsAlias({ name: 'products' })).resolves.toBe(
      true,
    );
  });

  it('faixa de preço casa só se alguma variante estiver dentro dela (CA18)', async () => {
    const shirt = product({ name: 'Camiseta lisa' }, [1000, 5000]);
    await seed(shirt);

    expect(await ids({ minPriceCents: 4000, maxPriceCents: 6000 })).toEqual([
      shirt.id,
    ]);
    expect(await ids({ minPriceCents: 6000, maxPriceCents: 8000 })).toEqual([]);
    expect(await ids({ minPriceCents: 2000, maxPriceCents: 4000 })).toEqual([]);
  });

  it('o resultado traz o menor e o maior preço, sem os preços de todas as variantes', async () => {
    const shirt = product({ name: 'Camiseta lisa' }, [5000, 1000, 3000]);
    await seed(shirt);

    const [item] = (await index.search({})).items;

    expect(item).toEqual({
      id: shirt.id,
      supplierId: SUPPLIER_ALFA,
      name: 'Camiseta lisa',
      description: shirt.description,
      category: 'vestuario',
      tags: [],
      minPriceCents: 1000,
      maxPriceCents: 5000,
    });
  });

  it('acha pelo nome no plural, por termo da descrição e pela tag exata (CA16)', async () => {
    const shirt = product({
      name: 'Camiseta básica',
      description: 'Malha de algodão penteado',
      tags: ['verão'],
    });
    const sneaker = product({
      name: 'Tênis de corrida',
      description: 'Solado de borracha',
      tags: ['esporte'],
    });
    await seed(shirt, sneaker);

    expect(await ids({ q: 'camisetas' })).toEqual([shirt.id]);
    expect(await ids({ q: 'borracha' })).toEqual([sneaker.id]);
    expect(await ids({ q: 'esporte' })).toEqual([sneaker.id]);
  });

  it('filtra pela categoria exata; categoria inexistente → lista vazia (CA17)', async () => {
    const shoe = product({ category: 'calcados' });
    const shirt = product({ category: 'vestuario' });
    await seed(shoe, shirt);

    expect(await ids({ category: 'calcados' })).toEqual([shoe.id]);
    expect(await ids({ category: 'inexistente' })).toEqual([]);
  });

  it('45 produtos em páginas de 20: 20, 20 e 5, sem repetir, e a última sem cursor (CA19)', async () => {
    const products = Array.from({ length: 45 }, (_, n) =>
      product({ name: `Item ${String(n + 1).padStart(2, '0')}` }),
    );
    await seed(...products);

    const pages = await allPages({ limit: 20 });

    expect(pages.map((page) => page.length)).toEqual([20, 20, 5]);
    expect(new Set(pages.flat()).size).toBe(45);
  });

  it('paginação com texto (cursor com score) também percorre tudo sem repetir', async () => {
    const products = Array.from({ length: 45 }, (_, n) =>
      product({ name: `Camiseta modelo ${n + 1}` }),
    );
    await seed(...products);

    const pages = await allPages({ q: 'camiseta', limit: 20 });

    expect(pages.map((page) => page.length)).toEqual([20, 20, 5]);
    expect(new Set(pages.flat()).size).toBe(45);
  });

  it('sem texto, nomes iguais são desempatados pelo id, na mesma ordem sempre (CA20)', async () => {
    const socks = [product({ name: 'Meia' }), product({ name: 'Meia' })];
    await seed(
      product({ name: 'Bermuda' }),
      ...socks,
      product({ name: 'Zíper' }),
    );

    const first = await ids({});
    const second = await ids({});

    const sockIds = socks.map((sock) => sock.id).sort();
    expect(first).toEqual(second);
    expect(first.slice(1, 3)).toEqual(sockIds);
  });

  it('remove tira o produto do índice; remover um id que não está lá não é erro', async () => {
    const shirt = product();
    await seed(shirt);

    await index.remove(shirt.id);
    await index.remove(randomUUID());
    await admin.indices.refresh({ index: 'products' });

    expect(await ids({})).toEqual([]);
  });

  it('ES travado → SearchUnavailableError em menos de 3 s (CA21)', async () => {
    await seed(product());
    await pause(container);
    try {
      const started = Date.now();

      await expect(index.search({})).rejects.toBeInstanceOf(
        SearchUnavailableError,
      );
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      await unpause(container);
    }
  });
});
