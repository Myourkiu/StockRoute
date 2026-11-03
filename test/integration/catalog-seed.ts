import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../apps/catalog/src/prisma/prisma.service';
import { SUPPLIER_ALFA } from '../fixtures/suppliers';

// Muitos produtos ativos de uma vez, direto pelo Prisma (uma variante e o
// estoque de cada). Criar um a um pelo repositório levaria segundos sem testar
// nada a mais. Devolve os ids.
export async function seedActiveProducts(
  prisma: PrismaService,
  count: number,
  prefix: string,
): Promise<string[]> {
  const rows = Array.from({ length: count }, (_, n) => ({
    id: randomUUID(),
    sku: `${prefix}-${n + 1}`,
  }));
  await prisma.product.createMany({
    data: rows.map(({ id }, n) => ({
      id,
      supplierId: SUPPLIER_ALFA,
      name: `Produto em lote ${n + 1}`,
      description: '',
      category: 'lote',
      tags: [],
    })),
  });
  await prisma.variant.createMany({
    data: rows.map(({ id, sku }) => ({
      productId: id,
      sku,
      attributes: {},
      wholesalePriceCents: 1000,
      minQuantity: 1,
    })),
  });
  await prisma.stock.createMany({
    data: rows.map(({ sku }) => ({ sku, available: 1 })),
  });
  return rows.map(({ id }) => id);
}
