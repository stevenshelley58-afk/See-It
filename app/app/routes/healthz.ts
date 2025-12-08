/**
 * Health check endpoint
 *
 * Checks:
 * - Database connectivity (SELECT 1)
 * - GCS client initialization (lightweight check)
 *
 * Returns 200 if healthy, 503 if unhealthy
 */
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { getGcsClient, GCS_BUCKET } from "../utils/gcs-client.server";

export const loader = async () => {
    const checks: Record<string, { status: "ok" | "error"; message?: string }> = {};
    let overallHealthy = true;

    // Check database
    try {
        await prisma.$queryRaw`SELECT 1`;
        checks.database = { status: "ok" };
    } catch (error) {
        checks.database = {
            status: "error",
            message: error instanceof Error ? error.message : "Database connection failed"
        };
        overallHealthy = false;
    }

    // Check GCS (non-blocking, just verify client can be created)
    try {
        const gcsClient = getGcsClient();
        // Try to get bucket metadata (lightweight operation)
        const bucket = gcsClient.bucket(GCS_BUCKET);
        // Just check if we can access bucket metadata, don't fail if bucket doesn't exist
        await bucket.getMetadata().catch(() => {
            // Bucket might not exist, that's ok for health check
        });
        checks.storage = { status: "ok" };
    } catch (error) {
        checks.storage = {
            status: "error",
            message: error instanceof Error ? error.message : "Storage check failed"
        };
        // Storage is not critical, don't fail health check
    }

    const status = overallHealthy ? 200 : 503;
    return json(
        {
            status: overallHealthy ? "healthy" : "unhealthy",
            checks,
            timestamp: new Date().toISOString()
        },
        { status }
    );
};
