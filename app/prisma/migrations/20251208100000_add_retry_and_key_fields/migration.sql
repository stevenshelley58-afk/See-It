-- Add retry_count and prepared_image_key to product_assets
ALTER TABLE "product_assets" ADD COLUMN "prepared_image_key" TEXT;
ALTER TABLE "product_assets" ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0;

-- Add retry_count and image_key to render_jobs
ALTER TABLE "render_jobs" ADD COLUMN "image_key" TEXT;
ALTER TABLE "render_jobs" ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0;
