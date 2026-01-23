-- Add Observability v2 fields to render_runs
ALTER TABLE "render_runs" ADD COLUMN IF NOT EXISTS "trace_id" TEXT;
ALTER TABLE "render_runs" ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "render_runs" ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMP(3);
ALTER TABLE "render_runs" ADD COLUMN IF NOT EXISTS "success_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "render_runs" ADD COLUMN IF NOT EXISTS "fail_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "render_runs" ADD COLUMN IF NOT EXISTS "timeout_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "render_runs" ADD COLUMN IF NOT EXISTS "telemetry_dropped" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "render_runs_trace_id_idx" ON "render_runs"("trace_id");
