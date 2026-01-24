-- Prompt control plane: ensure llm_calls FK constraints exist.
-- This migration cleans up orphaned references before adding constraints.

DO $$
BEGIN
  -- If llm_calls doesn't exist yet, nothing to do.
  IF to_regclass('public.llm_calls') IS NULL THEN
    RAISE NOTICE 'Skipping llm_calls FK migration: table llm_calls does not exist.';
    RETURN;
  END IF;

  -- ==========================================================================
  -- Clean up orphaned variant_result_id references
  -- ==========================================================================
  IF to_regclass('public.variant_results') IS NOT NULL THEN
    UPDATE "llm_calls" SET "variant_result_id" = NULL
    WHERE "variant_result_id" IS NOT NULL
      AND "variant_result_id" NOT IN (SELECT "id" FROM "variant_results");

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
  -- Clean up orphaned prompt_version_id references
  -- ==========================================================================
  IF to_regclass('public.prompt_control_versions') IS NOT NULL THEN
    UPDATE "llm_calls" SET "prompt_version_id" = NULL
    WHERE "prompt_version_id" IS NOT NULL
      AND "prompt_version_id" NOT IN (SELECT "id" FROM "prompt_control_versions");

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
  -- Clean up orphaned render_run_id references (delete orphaned rows)
  -- ==========================================================================
  IF to_regclass('public.render_runs') IS NOT NULL THEN
    DELETE FROM "llm_calls"
    WHERE "render_run_id" IS NOT NULL
      AND "render_run_id" NOT IN (SELECT "id" FROM "render_runs");

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
  -- Clean up orphaned test_run_id references (delete orphaned rows)
  -- ==========================================================================
  IF to_regclass('public.prompt_test_runs') IS NOT NULL THEN
    DELETE FROM "llm_calls"
    WHERE "test_run_id" IS NOT NULL
      AND "test_run_id" NOT IN (SELECT "id" FROM "prompt_test_runs");

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
