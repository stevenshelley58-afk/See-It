-- Add field-level provenance columns to product_assets
-- These columns are referenced by Prisma schema as:
--  field_confidence, field_source, field_overrides, field_evidence

ALTER TABLE "product_assets"
  ADD COLUMN "field_confidence" JSONB,
  ADD COLUMN "field_source" JSONB,
  ADD COLUMN "field_overrides" JSONB,
  ADD COLUMN "field_evidence" JSONB;

