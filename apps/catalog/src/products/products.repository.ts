import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SkuConflictError } from './product.errors';

export interface NewVariant {
  sku: string;
  attributes: Record<string, string>;
  wholesalePriceCents: number;
  minQuantity: number;
  initialStock: number;
}

export interface NewProduct {
  supplierId: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  variants: NewVariant[];
}

export type ProductChanges = Partial<
  Pick<NewProduct, 'name' | 'description' | 'category' | 'tags'>
> & { active?: boolean };

export type VariantChanges = Partial<
  Pick<NewVariant, 'attributes' | 'wholesalePriceCents' | 'minQuantity'>
>;

export interface VariantRecord {
  sku: string;
  attributes: Record<string, string>;
  wholesalePriceCents: number;
  minQuantity: number;
  available: number;
}

export interface ProductRecord {
  id: string;
  supplierId: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  variants: VariantRecord[];
}

// Variantes em ordem de SKU, cada uma com o estoque dela.
const withVariants = {
  variants: { orderBy: { sku: 'asc' }, include: { stock: true } },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof withVariants }>;

// Acesso ao Postgres do catalog. Só traduz entre o modelo do Prisma e o do
// domínio; regras (posse, visibilidade) ficam no ProductsService.
@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Produto, variantes e estoque num único `create` aninhado, que o Prisma
  // executa numa transação: um SKU repetido desfaz tudo.
  async create(input: NewProduct): Promise<ProductRecord> {
    const { variants, ...product } = input;
    const row = await this.translateSkuConflict(() =>
      this.prisma.product.create({
        data: {
          ...product,
          variants: { create: variants.map(toVariantCreate) },
        },
        include: withVariants,
      }),
    );
    return toRecord(row);
  }

  async findById(id: string): Promise<ProductRecord | null> {
    const row = await this.prisma.product.findUnique({
      where: { id },
      include: withVariants,
    });
    return row ? toRecord(row) : null;
  }

  async update(id: string, changes: ProductChanges): Promise<ProductRecord> {
    const row = await this.prisma.product.update({
      where: { id },
      data: pickProductChanges(changes),
      include: withVariants,
    });
    return toRecord(row);
  }

  async addVariant(
    productId: string,
    variant: NewVariant,
  ): Promise<ProductRecord> {
    const row = await this.translateSkuConflict(() =>
      this.prisma.product.update({
        where: { id: productId },
        data: { variants: { create: toVariantCreate(variant) } },
        include: withVariants,
      }),
    );
    return toRecord(row);
  }

  // `null` quando o SKU não existe ou é de outro produto.
  async updateVariant(
    productId: string,
    sku: string,
    changes: VariantChanges,
  ): Promise<ProductRecord | null> {
    const { count } = await this.prisma.variant.updateMany({
      where: { productId, sku },
      data: pickVariantChanges(changes),
    });
    return count === 0 ? null : this.findById(productId);
  }

  async setActive(id: string, active: boolean): Promise<void> {
    await this.prisma.product.update({ where: { id }, data: { active } });
  }

  private async translateSkuConflict<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new SkuConflictError();
      }
      throw error;
    }
  }
}

// Só os campos editáveis chegam ao Prisma, mesmo que um chamador interno mande
// outros (`supplierId`, `sku`). O gateway já barra isso na API pública; aqui é
// defesa em profundidade.
function pickProductChanges({
  name,
  description,
  category,
  tags,
  active,
}: ProductChanges): ProductChanges {
  return { name, description, category, tags, active };
}

function pickVariantChanges({
  attributes,
  wholesalePriceCents,
  minQuantity,
}: VariantChanges): VariantChanges {
  return { attributes, wholesalePriceCents, minQuantity };
}

function toVariantCreate({ initialStock, ...variant }: NewVariant) {
  return { ...variant, stock: { create: { available: initialStock } } };
}

function toRecord({ variants, ...product }: ProductRow): ProductRecord {
  return {
    ...product,
    variants: variants.map((variant) => ({
      sku: variant.sku,
      attributes: variant.attributes as Record<string, string>,
      wholesalePriceCents: variant.wholesalePriceCents,
      minQuantity: variant.minQuantity,
      available: variant.stock?.available ?? 0,
    })),
  };
}
