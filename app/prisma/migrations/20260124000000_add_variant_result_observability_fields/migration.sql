-- Add Observability v2 fields to variant_results
ALTER TABLE "variant_results" ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMP(3);
ALTER TABLE "variant_results" ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMP(3);
ALTER TABLE "variant_results" ADD COLUMN IF NOT EXISTS "provider_ms" INTEGER;
ALTER TABLE "variant_results" ADD COLUMN IF NOT EXISTS "upload_ms" INTEGER;
ALTER TABLE "variant_results" ADD COLUMN IF NOT EXISTS "error_code" TEXT;
ALTER TABLE "variant_results" ADD COLUMN IF NOT EXISTS "output_artifact_id" TEXT;
