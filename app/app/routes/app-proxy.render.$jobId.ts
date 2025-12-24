import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { StorageService } from "../services/storage.server";

function getCorsHeaders(shopDomain: string | null): Record<string, string> {
    // Only set CORS origin if we have a valid shop domain
    // Empty origin or "*" would be a security risk
    const headers: Record<string, string> = {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        // CRITICAL: Prevent caching of job status responses
        // Without this, browsers/proxies may cache "queued" status and never show "completed"
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
    };
    
    if (shopDomain) {
        headers["Access-Control-Allow-Origin"] = `https://${shopDomain}`;
    }
    
    return headers;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
    const { session } = await authenticate.public.appProxy(request);
    const corsHeaders = getCorsHeaders(session?.shop ?? null);

    if (!session) {
        return json({ status: "forbidden" }, { status: 403, headers: corsHeaders });
    }

    const { jobId } = params;

    const job = await prisma.renderJob.findUnique({
        where: { id: jobId },
        include: { shop: true }
    });

    if (!job || job.shop.shopDomain !== session.shop) {
        return json({ error: "Job not found" }, { status: 404, headers: corsHeaders });
    }

    // Generate fresh signed URL from stored key if available
    // This prevents 403 errors from expired signed URLs
    let imageUrl = job.imageUrl;
    if (job.status === "completed" && job.imageKey) {
        try {
            imageUrl = await StorageService.getSignedReadUrl(job.imageKey, 60 * 60 * 1000); // 1 hour
        } catch (error) {
            // Fall back to stored URL if regeneration fails
            console.warn(`[render.$jobId] Failed to regenerate URL from key ${job.imageKey}:`, error);
        }
    }

    return json({
        job_id: job.id,
        status: job.status,
        image_url: imageUrl,
        error_code: job.errorCode,
        error_message: job.errorMessage,
        // CamelCase kept for existing callers
        jobId: job.id,
        imageUrl: imageUrl,
        errorCode: job.errorCode,
        errorMessage: job.errorMessage
    }, { headers: corsHeaders });
};
