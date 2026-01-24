-- Add FK constraint from llm_calls.variant_result_id to variant_results
-- with ON DELETE SET NULL behavior

-- First, add the FK constraint for variant_result_id -> variant_results
-- Use DO block to handle case where constraint may already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'llm_calls_variant_result_id_fkey'
    AND table_name = 'llm_calls'
  ) THEN
    ALTER TABLE "llm_calls"
    ADD CONSTRAINT "llm_calls_variant_result_id_fkey"
    FOREIGN KEY ("variant_result_id")
    REFERENCES "variant_results"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;

-- Update the existing prompt_version_id FK constraint to have ON DELETE SET NULL
-- Drop and recreate the constraint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'llm_calls_prompt_version_id_fkey'
    AND table_name = 'llm_calls'
  ) THEN
    ALTER TABLE "llm_calls" DROP CONSTRAINT "llm_calls_prompt_version_id_fkey";
  END IF;
END $$;

ALTER TABLE "llm_calls"
ADD CONSTRAINT "llm_calls_prompt_version_id_fkey"
FOREIGN KEY ("prompt_version_id")
REFERENCES "prompt_versions"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- Add indexes for the FK columns to optimize queries
CREATE INDEX IF NOT EXISTS "llm_calls_variant_result_id_idx" ON "llm_calls"("variant_result_id");
CREATE INDEX IF NOT EXISTS "llm_calls_prompt_version_id_idx" ON "llm_calls"("prompt_version_id");
