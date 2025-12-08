-- AlterTable
ALTER TABLE "product_assets" ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "product_assets_shop_id_product_id_is_default_idx" ON "product_assets"("shop_id", "product_id", "is_default");
