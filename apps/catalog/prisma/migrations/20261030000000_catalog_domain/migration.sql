-- Domínio do catalog: fornecedores, produtos, variações (SKUs) e estoque.
-- Gerado com `prisma migrate diff` a partir do schema.prisma, mais as
-- restrições CHECK no fim, que o Prisma não expressa.
-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "min_order_value_cents" INTEGER NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tags" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variants" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "wholesale_price_cents" INTEGER NOT NULL,
    "min_quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock" (
    "sku" TEXT NOT NULL,
    "available" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_pkey" PRIMARY KEY ("sku")
);

-- CreateIndex
CREATE INDEX "products_supplier_id_idx" ON "products"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "variants_sku_key" ON "variants"("sku");

-- CreateIndex
CREATE INDEX "variants_product_id_idx" ON "variants"("product_id");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variants" ADD CONSTRAINT "variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock" ADD CONSTRAINT "stock_sku_fkey" FOREIGN KEY ("sku") REFERENCES "variants"("sku") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Restrições de valor: a API já valida, mas o banco é a última linha de defesa.
ALTER TABLE "variants" ADD CONSTRAINT "variants_wholesale_price_cents_check" CHECK ("wholesale_price_cents" > 0);
ALTER TABLE "variants" ADD CONSTRAINT "variants_min_quantity_check" CHECK ("min_quantity" >= 1);
ALTER TABLE "stock" ADD CONSTRAINT "stock_available_check" CHECK ("available" >= 0);
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_min_order_value_cents_check" CHECK ("min_order_value_cents" >= 0);
