import { repository } from "@/lib/db/repository";
import { loadQueueableJobs, persistEvent, persistJob } from "@/lib/db/supabase-persistence";
import { runRenderPipeline } from "@/lib/render/orchestrator";

export async function runLeasedJob(jobId: string) {
  const job = repository.mustGet(repository.jobs, jobId, "job");
  try {
    if (job.type === "render_request" && typeof job.payload.renderRequestId === "string") {
      await runRenderPipeline(job.payload.renderRequestId);
    }
    if (job.type === "purge_expired_assets") {
      purgeExpiredAssets();
    }
    if (job.type === "usage_rollup") {
      await persistEvent(repository.event({ surface: "billing", name: "usage_rollup_completed", props: job.payload }));
    }
    if (job.type === "sync_sender") {
      await persistEvent(repository.event({ surface: "outreach", name: "sender_sync_completed", props: job.payload }));
    }
    if (job.type === "demo_generate") {
      await persistEvent(repository.event({ surface: "demo", name: "demo_batch_completed", props: job.payload }));
    }
    if (job.type === "daily_digest") {
      await persistEvent(repository.event({ surface: "system", name: "daily_digest_completed", props: job.payload }));
    }
    const completed = repository.completeJob(job.id);
    await persistJob(completed);
    return completed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const failed = repository.failJob(job.id, "job_failed", message);
    await persistJob(failed);
    return failed;
  }
}

export async function sweepJobs(owner = "local-worker") {
  await loadQueueableJobs(10);
  const jobs = repository.leaseJobs(owner, 10);
  const results = [];
  for (const job of jobs) {
    await persistJob(job);
    results.push(await runLeasedJob(job.id));
  }
  return results;
}

export function purgeExpiredAssets() {
  let purged = 0;
  const now = Date.now();
  for (const [id, asset] of repository.renderAssets.entries()) {
    if (asset.retentionExpiresAt && new Date(asset.retentionExpiresAt).getTime() < now) {
      repository.renderAssets.set(id, { ...asset, storageKey: "asset unavailable due to retention policy" });
      purged += 1;
    }
  }
  return purged;
}
