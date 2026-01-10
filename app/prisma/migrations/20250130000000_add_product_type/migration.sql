-- AlterTable
ALTER TABLE "product_assets" ADD COLUMN "product_type" TEXT;

-- CreateIndex
CREATE INDEX "product_assets_shop_id_product_type_idx" ON "product_assets"("shop_id", "product_type");
