import { repository } from "@/lib/db/repository";
import { persistJob } from "@/lib/db/supabase-persistence";

export const JOB_TYPES = [
  "normalize_room",
  "extract_dimensions",
  "generate_cutout",
  "render_request",
  "quality_gate",
  "render_replay",
  "eval_run",
  "lifestyle_generate",
  "push_shopify_media",
  "demo_generate",
  "sync_sender",
  "purge_expired_assets",
  "usage_rollup",
  "daily_digest"
];

export function enqueueJob(type: string, payload: Record<string, unknown>, idempotencyKey: string, priority = 100, maxAttempts = 3) {
  if (!JOB_TYPES.includes(type)) {
    throw new Error("Unsupported job type: " + type);
  }
  return repository.enqueueJob({ type, payload, idempotencyKey, priority, maxAttempts, runAfter: new Date().toISOString() });
}

export async function enqueueDurableJob(type: string, payload: Record<string, unknown>, idempotencyKey: string, priority = 100, maxAttempts = 3) {
  const job = enqueueJob(type, payload, idempotencyKey, priority, maxAttempts);
  await persistJob(job);
  return job;
}

export function enqueueRenderJob(renderRequestId: string) {
  return enqueueJob("render_request", { renderRequestId }, "render_request:" + renderRequestId, 10, 3);
}

export function enqueueDurableRenderJob(renderRequestId: string) {
  return enqueueDurableJob("render_request", { renderRequestId }, "render_request:" + renderRequestId, 10, 3);
}

export function leaseJobs(owner: string, limit = 5) {
  return repository.leaseJobs(owner, limit);
}
