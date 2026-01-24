-- Prompt control plane: ensure llm_calls FK constraints exist.
-- This migration is production-safe: it only applies constraints when the
-- referenced tables exist, and it no-ops otherwise (so deploys don't fail).

DO $$
BEGIN
  -- If llm_calls doesn't exist yet, nothing to do.
  IF to_regclass('public.llm_calls') IS NULL THEN
    RAISE NOTICE 'Skipping llm_calls FK migration: table llm_calls does not exist.';
    RETURN;
  END IF;

  -- ==========================================================================
  -- llm_calls.variant_result_id -> variant_results(id) (ON DELETE SET NULL)
  -- ==========================================================================
  IF to_regclass('public.variant_results') IS NOT NULL THEN
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
  END IF;

  -- ==========================================================================
  -- llm_calls.prompt_version_id -> prompt_control_versions(id) (ON DELETE SET NULL)
  -- ==========================================================================
  IF to_regclass('public.prompt_control_versions') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'llm_calls_prompt_version_id_fkey'
        AND table_name = 'llm_calls'
    ) THEN
      ALTER TABLE "llm_calls" DROP CONSTRAINT "llm_calls_prompt_version_id_fkey";
    END IF;

    ALTER TABLE "llm_calls"
      ADD CONSTRAINT "llm_calls_prompt_version_id_fkey"
      FOREIGN KEY ("prompt_version_id")
      REFERENCES "prompt_control_versions"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;

  -- ==========================================================================
  -- llm_calls.render_run_id -> render_runs(id) (ON DELETE CASCADE)
  -- ==========================================================================
  IF to_regclass('public.render_runs') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'llm_calls_render_run_id_fkey'
        AND table_name = 'llm_calls'
    ) THEN
      ALTER TABLE "llm_calls"
        ADD CONSTRAINT "llm_calls_render_run_id_fkey"
        FOREIGN KEY ("render_run_id")
        REFERENCES "render_runs"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE;
    END IF;
  END IF;

  -- ==========================================================================
  -- llm_calls.test_run_id -> prompt_test_runs(id) (ON DELETE CASCADE)
  -- ==========================================================================
  IF to_regclass('public.prompt_test_runs') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'llm_calls_test_run_id_fkey'
        AND table_name = 'llm_calls'
    ) THEN
      ALTER TABLE "llm_calls"
        ADD CONSTRAINT "llm_calls_test_run_id_fkey"
        FOREIGN KEY ("test_run_id")
        REFERENCES "prompt_test_runs"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE;
    END IF;
  END IF;
END $$;

-- Indexes for common join / query patterns (safe if already exist).
CREATE INDEX IF NOT EXISTS "llm_calls_variant_result_id_idx" ON "llm_calls"("variant_result_id");
CREATE INDEX IF NOT EXISTS "llm_calls_prompt_version_id_idx" ON "llm_calls"("prompt_version_id");
