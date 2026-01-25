-- =============================================================================
-- CANONICAL PIPELINE SCHEMA MIGRATION
-- Destructive replacement of llm_calls, render_runs, variant_results
-- ALTER product_assets to drop legacy columns and add canonical ones
-- =============================================================================

-- =============================================================================
-- PREREQUISITE: Enable pgcrypto for gen_random_uuid()
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- PART 1: DROP AND RECREATE LLM_CALLS
-- =============================================================================
DROP TABLE IF EXISTS llm_calls CASCADE;

CREATE TABLE llm_calls (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,

  -- Owner context (NO DEFAULTS - force callers to populate)
  owner_type TEXT NOT NULL,  -- 'COMPOSITE_RUN' | 'PRODUCT_ASSET' | 'TEST_RUN'
  owner_id TEXT NOT NULL,
  variant_id TEXT,  -- null for non-variant calls

  -- Prompt context (NO DEFAULTS)
  prompt_key TEXT NOT NULL,  -- 'product_fact_extractor' | 'placement_set_generator' | 'composite_instruction'
  prompt_version_id TEXT REFERENCES prompt_control_versions(id) ON DELETE SET NULL,

  -- Identity hashes (NO DEFAULTS - force callers to populate)
  call_identity_hash TEXT NOT NULL,
  dedupe_hash TEXT,

  -- Payloads (call_summary and debug_payload are REQUIRED for auditability)
  call_summary JSONB NOT NULL,
  debug_payload JSONB NOT NULL,  -- REQUIRED: full Gemini request context
  output_summary JSONB,  -- nullable: populated on completion

  -- Status and timing
  status TEXT NOT NULL DEFAULT 'STARTED',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  latency_ms INTEGER,

  -- Tokens and cost
  tokens_in INTEGER,
  tokens_out INTEGER,
  cost_estimate DECIMAL(10,6),

  -- Error tracking
  error_type TEXT,
  error_message TEXT,

  -- Provider metadata
  provider_model TEXT,
  provider_request_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- CHECK CONSTRAINTS: prevent garbage states
  CONSTRAINT llm_calls_owner_type_chk CHECK (owner_type IN ('COMPOSITE_RUN', 'PRODUCT_ASSET', 'TEST_RUN')),
  CONSTRAINT llm_calls_status_chk CHECK (status IN ('STARTED', 'SUCCEEDED', 'FAILED', 'TIMEOUT')),
  CONSTRAINT llm_calls_prompt_key_chk CHECK (prompt_key IN ('product_fact_extractor', 'placement_set_generator', 'composite_instruction')),
  -- CHECK CONSTRAINTS: prevent empty strings on identity fields
  CONSTRAINT llm_calls_owner_id_nonempty_chk CHECK (length(owner_id) > 0),
  CONSTRAINT llm_calls_call_identity_hash_nonempty_chk CHECK (length(call_identity_hash) > 0)
);

CREATE INDEX idx_llm_calls_shop_created ON llm_calls(shop_id, created_at);
CREATE INDEX idx_llm_calls_owner ON llm_calls(owner_type, owner_id);
CREATE INDEX idx_llm_calls_prompt_key ON llm_calls(prompt_key, created_at);
CREATE INDEX idx_llm_calls_status ON llm_calls(status, created_at);
CREATE INDEX idx_llm_calls_call_identity_hash ON llm_calls(call_identity_hash);
CREATE INDEX idx_llm_calls_dedupe_hash ON llm_calls(dedupe_hash);

-- Partial unique index for dedupe protection (prevents duplicate in-flight writes)
CREATE UNIQUE INDEX ux_llm_calls_shop_dedupe_hash
  ON llm_calls(shop_id, dedupe_hash)
  WHERE dedupe_hash IS NOT NULL;

-- =============================================================================
-- PART 2: DROP AND RECREATE RENDER_RUNS
-- =============================================================================
DROP TABLE IF EXISTS variant_results CASCADE;
DROP TABLE IF EXISTS render_runs CASCADE;

CREATE TABLE render_runs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_asset_id TEXT NOT NULL REFERENCES product_assets(id) ON DELETE CASCADE,
  room_session_id TEXT REFERENCES room_sessions(id) ON DELETE SET NULL,

  trace_id TEXT NOT NULL,

  -- Image references
  prepared_product_image_ref TEXT NOT NULL,
  prepared_product_image_hash TEXT,
  room_image_ref TEXT NOT NULL,
  room_image_hash TEXT,

  -- Snapshots (complete audit trail)
  resolved_facts_snapshot JSONB NOT NULL,
  placement_set_snapshot JSONB NOT NULL,
  pipeline_config_snapshot JSONB NOT NULL,
  pipeline_config_hash TEXT NOT NULL,

  -- Status
  status TEXT NOT NULL DEFAULT 'RUNNING',

  -- Timing
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  total_duration_ms INTEGER,
  waterfall_ms JSONB,

  -- Aggregates
  success_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  timeout_count INTEGER NOT NULL DEFAULT 0,
  run_totals JSONB,

  -- CHECK CONSTRAINTS: prevent garbage states
  CONSTRAINT render_runs_status_chk CHECK (status IN ('RUNNING', 'COMPLETE', 'PARTIAL', 'FAILED')),
  -- CHECK CONSTRAINT: prevent empty string on identity field
  CONSTRAINT render_runs_trace_id_nonempty_chk CHECK (length(trace_id) > 0)
);

CREATE INDEX idx_render_runs_shop_created ON render_runs(shop_id, created_at);
CREATE INDEX idx_render_runs_product_asset ON render_runs(product_asset_id);
CREATE INDEX idx_render_runs_status ON render_runs(status);
CREATE INDEX idx_render_runs_trace ON render_runs(trace_id);
CREATE INDEX idx_render_runs_pipeline_hash ON render_runs(pipeline_config_hash);

-- =============================================================================
-- PART 3: CREATE VARIANT_RESULTS (fresh)
-- =============================================================================
CREATE TABLE variant_results (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  run_id TEXT NOT NULL REFERENCES render_runs(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL,  -- 'V01' .. 'V08'

  status TEXT NOT NULL,
  image_ref TEXT,
  image_hash TEXT,

  latency_ms INTEGER,
  error_code TEXT,
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(run_id, variant_id),

  -- CHECK CONSTRAINT: prevent garbage states
  CONSTRAINT variant_results_status_chk CHECK (status IN ('SUCCESS', 'FAILED', 'TIMEOUT'))
);

CREATE INDEX idx_variant_results_run ON variant_results(run_id);
CREATE INDEX idx_variant_results_status ON variant_results(status);

-- =============================================================================
-- PART 4: ALTER PRODUCT_ASSETS (drop legacy, add canonical)
-- =============================================================================

-- Drop ALL legacy columns
ALTER TABLE product_assets
  DROP COLUMN IF EXISTS render_instructions,
  DROP COLUMN IF EXISTS render_instructions_see_it_now,
  DROP COLUMN IF EXISTS scene_role,
  DROP COLUMN IF EXISTS replacement_rule,
  DROP COLUMN IF EXISTS allow_space_creation,
  DROP COLUMN IF EXISTS placement_fields,
  DROP COLUMN IF EXISTS field_confidence,
  DROP COLUMN IF EXISTS field_source,
  DROP COLUMN IF EXISTS field_overrides,
  DROP COLUMN IF EXISTS field_evidence,
  DROP COLUMN IF EXISTS generated_see_it_now_prompt,
  DROP COLUMN IF EXISTS see_it_now_variants,
  DROP COLUMN IF EXISTS detected_archetype,
  DROP COLUMN IF EXISTS use_generated_prompt,
  DROP COLUMN IF EXISTS prompt_pack,
  DROP COLUMN IF EXISTS prompt_pack_version;

-- Add canonical columns (if not exist)
ALTER TABLE product_assets
  ADD COLUMN IF NOT EXISTS placement_set JSONB,
  ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ;

-- Drop any orphaned indexes
DROP INDEX IF EXISTS idx_product_assets_prompt_pack;
DROP INDEX IF EXISTS idx_product_assets_archetype;

-- =============================================================================
-- PART 5: LEGACY TABLE CLEANUP
-- =============================================================================
-- Drop legacy prompt config table (PromptConfigVersion maps to "prompt_versions")
-- This conflicts with PromptVersion which maps to "prompt_control_versions"
DROP TABLE IF EXISTS prompt_versions CASCADE;
