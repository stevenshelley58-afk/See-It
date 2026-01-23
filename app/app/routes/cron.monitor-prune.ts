import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { getGcsClient, GCS_BUCKET } from "../utils/gcs-client.server";

/**
 * Monitor Data Prune Cron Job
 *
 * Deletes old telemetry data to manage database size:
 * - MonitorEvent rows older than 30 days
 * - MonitorArtifact rows past their expiresAt date (and their GCS files)
 *
 * RenderRun and VariantResult are NOT deleted (historical record).
 *
 * Requires CRON_SECRET environment variable for authentication.
 * Call with header: Authorization: Bearer <CRON_SECRET>
 *
 * Example cron setup (daily at 3am):
 * curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.railway.app/cron/monitor-prune
 */

const BATCH_SIZE = 500;
const MAX_BATCHES = 20; // Process up to 10,000 records per run

async function validateCronAuth(request: Request): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;

  // If no CRON_SECRET is set, only allow in development
  if (!cronSecret) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[MonitorPrune] CRON_SECRET not set - allowing request in development");
      return true;
    }
    console.error("[MonitorPrune] CRON_SECRET not configured");
    return false;
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return false;
  }

  // Support both "Bearer <token>" and raw token
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  return token === cronSecret;
}

async function deleteGcsFile(key: string): Promise<boolean> {
  try {
    const storage = getGcsClient();
    const bucket = storage.bucket(GCS_BUCKET);
    await bucket.file(key).delete({ ignoreNotFound: true });
    return true;
  } catch (error) {
    console.error(`[MonitorPrune] Failed to delete GCS file ${key}:`, error);
    return false;
  }
}

async function pruneOldEvents(): Promise<{ deleted: number; errors: number }> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30); // 30 days ago

  let totalDeleted = 0;
  let totalErrors = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    try {
      const result = await prisma.monitorEvent.deleteMany({
        where: {
          ts: { lt: cutoffDate },
        },
      });

      if (result.count === 0) {
        break; // No more records to delete
      }

      totalDeleted += result.count;
      console.log(`[MonitorPrune] Events batch ${batch + 1}: deleted ${result.count}`);

      // If we deleted less than batch size, we're done
      if (result.count < BATCH_SIZE) {
        break;
      }
    } catch (error) {
      console.error(`[MonitorPrune] Events batch ${batch + 1} failed:`, error);
      totalErrors++;
      break;
    }
  }

  return { deleted: totalDeleted, errors: totalErrors };
}

async function pruneExpiredArtifacts(): Promise<{
  deleted: number;
  gcsDeleted: number;
  gcsErrors: number;
  errors: number;
}> {
  const now = new Date();
  let totalDeleted = 0;
  let totalGcsDeleted = 0;
  let totalGcsErrors = 0;
  let totalErrors = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    try {
      // Find expired artifacts
      const expiredArtifacts = await prisma.monitorArtifact.findMany({
        where: {
          expiresAt: { lt: now },
        },
        take: BATCH_SIZE,
        select: {
          id: true,
          gcsKey: true,
        },
      });

      if (expiredArtifacts.length === 0) {
        break; // No more expired artifacts
      }

      console.log(`[MonitorPrune] Artifacts batch ${batch + 1}: processing ${expiredArtifacts.length}`);

      // Delete GCS files for each artifact
      for (const artifact of expiredArtifacts) {
        if (artifact.gcsKey) {
          const success = await deleteGcsFile(artifact.gcsKey);
          if (success) {
            totalGcsDeleted++;
          } else {
            totalGcsErrors++;
          }
        }
      }

      // Delete the artifact records
      const ids = expiredArtifacts.map((a) => a.id);
      const result = await prisma.monitorArtifact.deleteMany({
        where: { id: { in: ids } },
      });

      totalDeleted += result.count;

      // If we processed less than batch size, we're done
      if (expiredArtifacts.length < BATCH_SIZE) {
        break;
      }
    } catch (error) {
      console.error(`[MonitorPrune] Artifacts batch ${batch + 1} failed:`, error);
      totalErrors++;
      break;
    }
  }

  return {
    deleted: totalDeleted,
    gcsDeleted: totalGcsDeleted,
    gcsErrors: totalGcsErrors,
    errors: totalErrors,
  };
}

async function runPruneJob(): Promise<{
  eventsDeleted: number;
  eventsErrors: number;
  artifactsDeleted: number;
  artifactGcsDeleted: number;
  artifactGcsErrors: number;
  artifactsErrors: number;
}> {
  // Prune old events
  const eventsResult = await pruneOldEvents();

  // Prune expired artifacts
  const artifactsResult = await pruneExpiredArtifacts();

  return {
    eventsDeleted: eventsResult.deleted,
    eventsErrors: eventsResult.errors,
    artifactsDeleted: artifactsResult.deleted,
    artifactGcsDeleted: artifactsResult.gcsDeleted,
    artifactGcsErrors: artifactsResult.gcsErrors,
    artifactsErrors: artifactsResult.errors,
  };
}

// Support both GET and POST for flexibility with different cron services
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!(await validateCronAuth(request))) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    console.log("[MonitorPrune] Starting prune job...");

    const result = await runPruneJob();

    const duration = Date.now() - startTime;

    console.log(
      `[MonitorPrune] Completed in ${duration}ms: ` +
        `${result.eventsDeleted} events deleted (${result.eventsErrors} errors), ` +
        `${result.artifactsDeleted} artifacts deleted (${result.artifactGcsDeleted} GCS files, ${result.artifactGcsErrors} GCS errors)`
    );

    return json({
      success: true,
      duration_ms: duration,
      ...result,
    });
  } catch (error) {
    console.error("[MonitorPrune] Job failed:", error);
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  // Reuse loader logic for POST requests
  return loader({ request, params: {}, context: {} });
};
