import { repository } from "@/lib/db/repository";
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
    repository.completeJob(job.id);
    return repository.mustGet(repository.jobs, job.id, "job");
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return repository.failJob(job.id, "job_failed", message);
  }
}

export async function sweepJobs(owner = "local-worker") {
  const jobs = repository.leaseJobs(owner, 10);
  const results = [];
  for (const job of jobs) {
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
