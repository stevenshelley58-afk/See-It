import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { CORS_HEADERS } from "./app-proxy.render"; // We'll need to export this or redefine

// Redefine since we can't easily import non-exported, and to be safe
const HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
    // Handle preflight/OPTIONS just in case
    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: HEADERS });
    }

    const { jobId } = params;

    if (!jobId) {
        return json({ error: "Missing Job ID" }, { status: 400, headers: HEADERS });
    }

    // Authenticate (optional for status check? usually yes, but public proxy)
    // The render job ID is a UUID, so relatively hard to guess.
    // We can allow public access to status if they have the ID.
    // Or we can check appProxy auth.
    // Let's check appProxy auth for security.
    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
        return json({ status: "forbidden" }, { status: 403, headers: HEADERS });
    }

    const job = await prisma.renderJob.findUnique({
        where: { id: jobId }
    });

    if (!job) {
        return json({ status: "not_found" }, { status: 404, headers: HEADERS });
    }

    // Return status
    return json({
        status: job.status,
        imageUrl: job.imageUrl,
        errorMessage: job.errorMessage
    }, { headers: HEADERS });
};
