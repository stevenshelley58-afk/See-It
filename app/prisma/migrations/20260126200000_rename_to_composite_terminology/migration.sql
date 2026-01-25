-- =============================================================================
-- Migration: Rename render_runs/variant_results to composite_runs/composite_variants
-- Also fix llm_calls dedupe_hash (ensure no unique constraint)
-- =============================================================================

-- Drop and recreate with correct naming
DROP TABLE IF EXISTS variant_results CASCADE;
DROP TABLE IF EXISTS render_runs CASCADE;

-- Create composite_runs (was render_runs)
CREATE TABLE composite_runs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_asset_id TEXT NOT NULL REFERENCES product_assets(id) ON DELETE CASCADE,
  room_session_id TEXT REFERENCES room_sessions(id) ON DELETE SET NULL,
  trace_id TEXT NOT NULL,
  prepared_product_image_ref TEXT NOT NULL,
  prepared_product_image_hash TEXT,
  room_image_ref TEXT NOT NULL,
  room_image_hash TEXT,
  resolved_facts_snapshot JSONB NOT NULL,
  placement_set_snapshot JSONB NOT NULL,
  pipeline_config_snapshot JSONB NOT NULL,
  pipeline_config_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RUNNING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  total_duration_ms INTEGER,
  waterfall_ms JSONB,
  success_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  timeout_count INTEGER NOT NULL DEFAULT 0,
  run_totals JSONB,
  CONSTRAINT composite_runs_status_chk CHECK (status IN ('RUNNING', 'COMPLETE', 'PARTIAL', 'FAILED')),
  CONSTRAINT composite_runs_trace_id_nonempty_chk CHECK (length(trace_id) > 0),
  CONSTRAINT composite_runs_pipeline_hash_nonempty_chk CHECK (length(pipeline_config_hash) > 0)
);

-- Indexes for composite_runs
CREATE INDEX idx_composite_runs_shop_created ON composite_runs(shop_id, created_at);
CREATE INDEX idx_composite_runs_product_asset ON composite_runs(product_asset_id);
CREATE INDEX idx_composite_runs_status ON composite_runs(status);
CREATE INDEX idx_composite_runs_trace ON composite_runs(trace_id);
CREATE INDEX idx_composite_runs_pipeline_hash ON composite_runs(pipeline_config_hash);

-- Create composite_variants (was variant_results)
CREATE TABLE composite_variants (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  run_id TEXT NOT NULL REFERENCES composite_runs(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL,
  status TEXT NOT NULL,
  image_ref TEXT,
  image_hash TEXT,
  latency_ms INTEGER,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(run_id, variant_id),
  CONSTRAINT composite_variants_status_chk CHECK (status IN ('SUCCESS', 'FAILED', 'TIMEOUT')),
  CONSTRAINT composite_variants_variant_id_nonempty_chk CHECK (length(variant_id) > 0)
);

CREATE INDEX idx_composite_variants_run ON composite_variants(run_id);
CREATE INDEX idx_composite_variants_status ON composite_variants(status);

-- Fix llm_calls: ensure no unique constraint on dedupe_hash, only regular index
DROP INDEX IF EXISTS ux_llm_calls_shop_dedupe_hash;
DROP INDEX IF EXISTS idx_llm_calls_shop_dedupe_hash;
CREATE INDEX idx_llm_calls_shop_dedupe_hash ON llm_calls(shop_id, dedupe_hash) WHERE dedupe_hash IS NOT NULL;
