-- Add Prompt Control Plane fields to render_runs
-- These columns store per-run overrides, config snapshots, and timing/totals

-- prompt_overrides: Per-run prompt overrides (optional)
ALTER TABLE "render_runs" ADD COLUMN IF NOT EXISTS "prompt_overrides" JSONB;

-- resolved_config_snapshot: Complete resolved config for audit/replay
ALTER TABLE "render_runs" ADD COLUMN IF NOT EXISTS "resolved_config_snapshot" JSONB;

-- waterfall_ms: Timing breakdown (download, prompt_build, inference, upload, total)
ALTER TABLE "render_runs" ADD COLUMN IF NOT EXISTS "waterfall_ms" JSONB;

-- run_totals: Aggregated totals (tokens_in, tokens_out, cost_estimate, calls_total, calls_failed)
ALTER TABLE "render_runs" ADD COLUMN IF NOT EXISTS "run_totals" JSONB;
