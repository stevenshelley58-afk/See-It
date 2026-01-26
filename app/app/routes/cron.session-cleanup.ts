import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { getGcsClient, GCS_BUCKET } from "../utils/gcs-client.server";
import { validateCronAuth } from "../utils/cron-auth.server";

/**
 * Room Session Cleanup Cron Job
 *
 * Deletes expired room sessions and their associated GCS files.
 * Can be triggered via GET (for cron services) or POST.
 *
 * Requires CRON_SECRET environment variable for authentication.
 * Call with header: Authorization: Bearer <CRON_SECRET>
 *
 * Example cron setup (every hour):
 * curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.railway.app/cron/session-cleanup
 */

const BATCH_SIZE = 100;
const MAX_BATCHES = 10; // Process up to 1000 sessions per run

async function deleteGcsFiles(keys: string[]): Promise<{ deleted: number; errors: number }> {
    const storage = getGcsClient();
    const bucket = storage.bucket(GCS_BUCKET);

    let deleted = 0;
    let errors = 0;

    for (const key of keys) {
        if (!key) continue;

        try {
            await bucket.file(key).delete({ ignoreNotFound: true });
            deleted++;
        } catch (error) {
            console.error(`[SessionCleanup] Failed to delete GCS file ${key}:`, error);
            errors++;
        }
    }

    return { deleted, errors };
}

async function deleteGcsDirectory(shopId: string, sessionId: string): Promise<{ deleted: number; errors: number }> {
    const storage = getGcsClient();
    const bucket = storage.bucket(GCS_BUCKET);

    const prefix = `rooms/${shopId}/${sessionId}/`;

    try {
        const [files] = await bucket.getFiles({ prefix });

        if (files.length === 0) {
            return { deleted: 0, errors: 0 };
        }

        let deleted = 0;
        let errors = 0;

        for (const file of files) {
            try {
                await file.delete({ ignoreNotFound: true });
                deleted++;
            } catch (error) {
                console.error(`[SessionCleanup] Failed to delete file ${file.name}:`, error);
                errors++;
            }
        }

        return { deleted, errors };
    } catch (error) {
        console.error(`[SessionCleanup] Failed to list files in ${prefix}:`, error);
        return { deleted: 0, errors: 1 };
    }
}

async function cleanupExpiredSessions(): Promise<{
    sessionsDeleted: number;
    gcsFilesDeleted: number;
    gcsErrors: number;
    renderJobsDeleted: number;
}> {
    const now = new Date();
    let totalSessionsDeleted = 0;
    let totalGcsFilesDeleted = 0;
    let totalGcsErrors = 0;
    let totalRenderJobsDeleted = 0;

    for (let batch = 0; batch < MAX_BATCHES; batch++) {
        // Find expired sessions with their associated data
        const expiredSessions = await prisma.roomSession.findMany({
            where: {
                expiresAt: { lt: now }
            },
            take: BATCH_SIZE,
            select: {
                id: true,
                shopId: true,
                originalRoomImageKey: true,
                cleanedRoomImageKey: true,
                renderJobs: {
                    select: {
                        id: true,
                        imageKey: true
                    }
                }
            }
        });

        if (expiredSessions.length === 0) {
            break;
        }

        console.log(`[SessionCleanup] Processing batch ${batch + 1}: ${expiredSessions.length} sessions`);

        for (const session of expiredSessions) {
            // Collect all GCS keys to delete
            const keysToDelete: string[] = [];

            if (session.originalRoomImageKey) {
                keysToDelete.push(session.originalRoomImageKey);
            }
            if (session.cleanedRoomImageKey) {
                keysToDelete.push(session.cleanedRoomImageKey);
            }

            // Add render job image keys
            for (const job of session.renderJobs) {
                if (job.imageKey) {
                    keysToDelete.push(job.imageKey);
                }
            }

            // Delete individual known keys
            if (keysToDelete.length > 0) {
                const { deleted, errors } = await deleteGcsFiles(keysToDelete);
                totalGcsFilesDeleted += deleted;
                totalGcsErrors += errors;
            }

            // Also delete any other files in the session's GCS directory
            const { deleted: dirDeleted, errors: dirErrors } = await deleteGcsDirectory(
                session.shopId,
                session.id
            );
            totalGcsFilesDeleted += dirDeleted;
            totalGcsErrors += dirErrors;

            // Delete render jobs associated with this session (cascade would handle this,
            // but we want to track the count)
            const deletedJobs = await prisma.renderJob.deleteMany({
                where: { roomSessionId: session.id }
            });
            totalRenderJobsDeleted += deletedJobs.count;

            // Delete the session
            await prisma.roomSession.delete({
                where: { id: session.id }
            });
            totalSessionsDeleted++;
        }
    }

    return {
        sessionsDeleted: totalSessionsDeleted,
        gcsFilesDeleted: totalGcsFilesDeleted,
        gcsErrors: totalGcsErrors,
        renderJobsDeleted: totalRenderJobsDeleted
    };
}

// Support both GET and POST for flexibility with different cron services
export const loader = async ({ request }: LoaderFunctionArgs) => {
    if (!await validateCronAuth(request, "SessionCleanup")) {
        return json({ error: "Unauthorized" }, { status: 401 });
    }

    const startTime = Date.now();

    try {
        console.log("[SessionCleanup] Starting cleanup job...");

        const result = await cleanupExpiredSessions();

        const duration = Date.now() - startTime;

        console.log(
            `[SessionCleanup] Completed in ${duration}ms: ` +
            `${result.sessionsDeleted} sessions, ${result.gcsFilesDeleted} files deleted, ` +
            `${result.renderJobsDeleted} render jobs, ${result.gcsErrors} errors`
        );

        return json({
            success: true,
            duration_ms: duration,
            ...result
        });
    } catch (error) {
        console.error("[SessionCleanup] Job failed:", error);
        return json({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error"
        }, { status: 500 });
    }
};

export const action = async ({ request }: ActionFunctionArgs) => {
    // Reuse loader logic for POST requests
    return loader({ request, params: {}, context: {} });
};
