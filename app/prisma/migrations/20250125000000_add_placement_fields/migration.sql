-- Add placement_fields JSON column to product_assets
-- This stores structured placement fields: surface, material, orientation, shadow, dimensions, additionalNotes
-- Also includes optional fieldSource to track merchant vs auto provenance

ALTER TABLE "product_assets"
  ADD COLUMN "placement_fields" JSONB;
