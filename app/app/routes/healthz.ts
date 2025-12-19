/**
 * Health check endpoint
 *
 * Checks:
 * - Database connectivity (SELECT 1)
 * - GCS client initialization (lightweight check)
 * - Gemini API connectivity (list models - lightweight API call)
 *
 * Returns 200 if healthy, 503 if unhealthy
 */
import { json } from "@remix-run/node";
import { GoogleGenAI } from "@google/genai";
import prisma from "../db.server";
import { getGcsClient, GCS_BUCKET } from "../utils/gcs-client.server";

// Timeout for health check API calls (5 seconds)
const HEALTH_CHECK_TIMEOUT_MS = 5000;

/**
 * Wrap a promise with a timeout for health checks
 */
function withHealthCheckTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number = HEALTH_CHECK_TIMEOUT_MS
): Promise<T> {
    let timeoutId: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`Health check timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    });
}

export const loader = async () => {
    const checks: Record<string, { status: "ok" | "error" | "warning"; message?: string }> = {};
    let overallHealthy = true;

    // Check database (critical)
    try {
        await withHealthCheckTimeout(prisma.$queryRaw`SELECT 1`);
        checks.database = { status: "ok" };
    } catch (error) {
        checks.database = {
            status: "error",
            message: error instanceof Error ? error.message : "Database connection failed"
        };
        overallHealthy = false;
    }

    // Check GCS (non-critical, just verify client can be created)
    try {
        const gcsClient = getGcsClient();
        // Try to get bucket metadata (lightweight operation)
        const bucket = gcsClient.bucket(GCS_BUCKET);
        // Just check if we can access bucket metadata, don't fail if bucket doesn't exist
        await withHealthCheckTimeout(
            bucket.getMetadata().catch(() => {
                // Bucket might not exist, that's ok for health check
            })
        );
        checks.storage = { status: "ok" };
    } catch (error) {
        checks.storage = {
            status: "warning",
            message: error instanceof Error ? error.message : "Storage check failed"
        };
        // Storage is not critical, don't fail health check
    }

    // Check Gemini API (non-critical but important for core functionality)
    if (process.env.GEMINI_API_KEY) {
        try {
            const geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

            // Use list models as a lightweight ping - verifies API key and connectivity
            // This doesn't consume generation credits
            const modelsResult = await withHealthCheckTimeout(
                geminiClient.models.list()
            );

            // Check if we got any models back (indicates successful API call)
            let modelCount = 0;
            for await (const _model of modelsResult) {
                modelCount++;
                if (modelCount >= 1) break; // Just need to verify we can iterate
            }

            if (modelCount > 0) {
                checks.gemini = { status: "ok" };
            } else {
                checks.gemini = {
                    status: "warning",
                    message: "Gemini API responded but no models found"
                };
            }
        } catch (error) {
            checks.gemini = {
                status: "warning",
                message: error instanceof Error ? error.message : "Gemini API check failed"
            };
            // Gemini is important but don't fail overall health check
            // The app can still serve cached content and queue new renders
        }
    } else {
        checks.gemini = {
            status: "warning",
            message: "GEMINI_API_KEY not configured"
        };
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




