-- Prompt Control Plane tables (safe + idempotent)
-- Creates enums + tables required by prisma/schema.prisma for prompt control + instrumentation.
-- This migration is written to be safe in production: it only creates missing objects.

-- ============================================================================
-- Enums
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PromptStatus') THEN
    CREATE TYPE "PromptStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CallStatus') THEN
    CREATE TYPE "CallStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED', 'TIMEOUT');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AuditAction') THEN
    CREATE TYPE "AuditAction" AS ENUM (
      'PROMPT_CREATE',
      'PROMPT_UPDATE_DRAFT',
      'PROMPT_ACTIVATE',
      'PROMPT_ARCHIVE',
      'PROMPT_ROLLBACK',
      'RUNTIME_UPDATE',
      'TEST_RUN'
    );
  END IF;
END $$;

-- ============================================================================
-- prompt_definitions
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'prompt_definitions'
  ) THEN
    CREATE TABLE "prompt_definitions" (
      "id" TEXT NOT NULL,
      "shop_id" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "default_model" TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
      "default_params" JSONB,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "prompt_definitions_pkey" PRIMARY KEY ("id")
    );

    ALTER TABLE "prompt_definitions"
      ADD CONSTRAINT "prompt_definitions_shop_id_fkey"
      FOREIGN KEY ("shop_id") REFERENCES "shops"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;

    CREATE UNIQUE INDEX "prompt_definitions_shop_id_name_key"
      ON "prompt_definitions"("shop_id", "name");
    CREATE INDEX "prompt_definitions_shop_id_idx"
      ON "prompt_definitions"("shop_id");
  END IF;
END $$;

-- ============================================================================
-- prompt_control_versions
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'prompt_control_versions'
  ) THEN
    CREATE TABLE "prompt_control_versions" (
      "id" TEXT NOT NULL,
      "prompt_definition_id" TEXT NOT NULL,
      "version" INTEGER NOT NULL,
      "status" "PromptStatus" NOT NULL DEFAULT 'DRAFT',
      "system_template" TEXT,
      "developer_template" TEXT,
      "user_template" TEXT,
      "model" TEXT,
      "params" JSONB,
      "template_hash" TEXT NOT NULL,
      "change_notes" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "created_by" TEXT NOT NULL,
      "activated_at" TIMESTAMP(3),
      "activated_by" TEXT,
      "previous_active_version_id" TEXT,
      CONSTRAINT "prompt_control_versions_pkey" PRIMARY KEY ("id")
    );

    ALTER TABLE "prompt_control_versions"
      ADD CONSTRAINT "prompt_control_versions_prompt_definition_id_fkey"
      FOREIGN KEY ("prompt_definition_id") REFERENCES "prompt_definitions"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;

    CREATE UNIQUE INDEX "prompt_control_versions_prompt_definition_id_version_key"
      ON "prompt_control_versions"("prompt_definition_id", "version");
    CREATE INDEX "prompt_control_versions_prompt_definition_id_status_idx"
      ON "prompt_control_versions"("prompt_definition_id", "status");
  END IF;
END $$;

-- ============================================================================
-- shop_runtime_configs
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'shop_runtime_configs'
  ) THEN
    CREATE TABLE "shop_runtime_configs" (
      "id" TEXT NOT NULL,
      "shop_id" TEXT NOT NULL,
      "max_concurrency" INTEGER NOT NULL DEFAULT 5,
      "force_fallback_model" TEXT,
      "model_allow_list" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      "max_tokens_output_cap" INTEGER NOT NULL DEFAULT 8192,
      "max_image_bytes_cap" INTEGER NOT NULL DEFAULT 20000000,
      "daily_cost_cap" DECIMAL(10, 2) NOT NULL DEFAULT 50.00,
      "disabled_prompt_names" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      "updated_at" TIMESTAMP(3) NOT NULL,
      "updated_by" TEXT NOT NULL,
      CONSTRAINT "shop_runtime_configs_pkey" PRIMARY KEY ("id")
    );

    ALTER TABLE "shop_runtime_configs"
      ADD CONSTRAINT "shop_runtime_configs_shop_id_fkey"
      FOREIGN KEY ("shop_id") REFERENCES "shops"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;

    CREATE UNIQUE INDEX "shop_runtime_configs_shop_id_key"
      ON "shop_runtime_configs"("shop_id");
  END IF;
END $$;

-- ============================================================================
-- prompt_test_runs
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'prompt_test_runs'
  ) THEN
    CREATE TABLE "prompt_test_runs" (
      "id" TEXT NOT NULL,
      "shop_id" TEXT NOT NULL,
      "prompt_name" TEXT NOT NULL,
      "prompt_version_id" TEXT,
      "variables" JSONB,
      "image_refs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      "overrides" JSONB,
      "status" TEXT NOT NULL,
      "output" JSONB,
      "latency_ms" INTEGER,
      "tokens_in" INTEGER,
      "tokens_out" INTEGER,
      "cost_estimate" DECIMAL(10, 6),
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "created_by" TEXT NOT NULL,
      CONSTRAINT "prompt_test_runs_pkey" PRIMARY KEY ("id")
    );

    ALTER TABLE "prompt_test_runs"
      ADD CONSTRAINT "prompt_test_runs_shop_id_fkey"
      FOREIGN KEY ("shop_id") REFERENCES "shops"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;

    CREATE INDEX "prompt_test_runs_shop_id_prompt_name_created_at_idx"
      ON "prompt_test_runs"("shop_id", "prompt_name", "created_at");
  END IF;
END $$;

-- ============================================================================
-- prompt_audit_log
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'prompt_audit_log'
  ) THEN
    CREATE TABLE "prompt_audit_log" (
      "id" TEXT NOT NULL,
      "shop_id" TEXT NOT NULL,
      "actor" TEXT NOT NULL,
      "action" "AuditAction" NOT NULL,
      "target_type" TEXT NOT NULL,
      "target_id" TEXT NOT NULL,
      "target_name" TEXT,
      "before" JSONB,
      "after" JSONB,
      "ip_address" TEXT,
      "user_agent" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "prompt_audit_log_pkey" PRIMARY KEY ("id")
    );

    ALTER TABLE "prompt_audit_log"
      ADD CONSTRAINT "prompt_audit_log_shop_id_fkey"
      FOREIGN KEY ("shop_id") REFERENCES "shops"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;

    CREATE INDEX "prompt_audit_log_shop_id_created_at_idx"
      ON "prompt_audit_log"("shop_id", "created_at");
    CREATE INDEX "prompt_audit_log_shop_id_target_type_target_id_idx"
      ON "prompt_audit_log"("shop_id", "target_type", "target_id");
    CREATE INDEX "prompt_audit_log_shop_id_action_idx"
      ON "prompt_audit_log"("shop_id", "action");
  END IF;
END $$;

-- ============================================================================
-- llm_calls (created WITHOUT FKs; later migration adds/adjusts constraints)
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'llm_calls'
  ) THEN
    CREATE TABLE "llm_calls" (
      "id" TEXT NOT NULL,
      "shop_id" TEXT NOT NULL,
      "render_run_id" TEXT,
      "variant_result_id" TEXT,
      "test_run_id" TEXT,
      "prompt_name" TEXT NOT NULL,
      "prompt_version_id" TEXT,
      "model" TEXT NOT NULL,
      "resolution_hash" TEXT NOT NULL,
      "request_hash" TEXT NOT NULL,
      "status" "CallStatus" NOT NULL,
      "started_at" TIMESTAMP(3) NOT NULL,
      "finished_at" TIMESTAMP(3),
      "latency_ms" INTEGER,
      "tokens_in" INTEGER,
      "tokens_out" INTEGER,
      "cost_estimate" DECIMAL(10, 6),
      "error_type" TEXT,
      "error_message" TEXT,
      "retry_count" INTEGER NOT NULL DEFAULT 0,
      "provider_request_id" TEXT,
      "provider_model" TEXT,
      "input_ref" JSONB,
      "output_ref" JSONB,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "llm_calls_pkey" PRIMARY KEY ("id")
    );

    ALTER TABLE "llm_calls"
      ADD CONSTRAINT "llm_calls_shop_id_fkey"
      FOREIGN KEY ("shop_id") REFERENCES "shops"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;

    -- Note: render_runs / variant_results may not exist in all environments yet.
    -- FK constraints are handled in a later migration with presence checks.

    CREATE INDEX "llm_calls_shop_id_created_at_idx" ON "llm_calls"("shop_id", "created_at");
    CREATE INDEX "llm_calls_render_run_id_idx" ON "llm_calls"("render_run_id");
    CREATE INDEX "llm_calls_test_run_id_idx" ON "llm_calls"("test_run_id");
    CREATE INDEX "llm_calls_variant_result_id_idx" ON "llm_calls"("variant_result_id");
    CREATE INDEX "llm_calls_prompt_version_id_idx" ON "llm_calls"("prompt_version_id");
    CREATE INDEX "llm_calls_prompt_name_created_at_idx" ON "llm_calls"("prompt_name", "created_at");
    CREATE INDEX "llm_calls_status_created_at_idx" ON "llm_calls"("status", "created_at");
  END IF;
END $$;

