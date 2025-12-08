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
import { Storage } from "@google-cloud/storage";

let storage: Storage | null = null;

// Initialize GCS client (same logic as gemini.server.ts)
function getStorageClient(): Storage | null {
    if (storage) {
        return storage;
    }

    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        try {
            let jsonString = process.env.GOOGLE_CREDENTIALS_JSON.trim();
            if (jsonString.startsWith('"') && jsonString.endsWith('"')) {
                jsonString = jsonString.slice(1, -1);
            }
            let credentials;
            try {
                const decoded = Buffer.from(jsonString, 'base64').toString('utf-8');
                if (decoded.startsWith('{')) {
                    credentials = JSON.parse(decoded);
                } else {
                    credentials = JSON.parse(jsonString);
                }
            } catch {
                credentials = JSON.parse(jsonString);
            }
            storage = new Storage({ credentials });
        } catch (error) {
            // GCS not critical for health, just log
            console.warn("[healthz] GCS credentials parse failed, continuing without GCS check");
            return null;
        }
    } else {
        storage = new Storage();
    }

    return storage;
}

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
        const gcsClient = getStorageClient();
        if (gcsClient) {
            // Try to get bucket metadata (lightweight operation)
            const bucketName = process.env.GCS_BUCKET || 'see-it-room';
            const bucket = gcsClient.bucket(bucketName);
            // Just check if we can access bucket metadata, don't fail if bucket doesn't exist
            await bucket.getMetadata().catch(() => {
                // Bucket might not exist, that's ok for health check
            });
            checks.storage = { status: "ok" };
        } else {
            checks.storage = { status: "ok", message: "GCS not configured (optional)" };
        }
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

