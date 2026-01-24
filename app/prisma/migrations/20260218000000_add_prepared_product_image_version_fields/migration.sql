-- Add prepared product image versioning fields to product_assets
ALTER TABLE "product_assets" ADD COLUMN "prepared_product_image_version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "product_assets" ADD COLUMN "prepared_product_image_updated_at" TIMESTAMP(3);

