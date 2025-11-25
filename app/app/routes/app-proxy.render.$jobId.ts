import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
        return json({ status: "forbidden" }, { status: 403, headers: CORS_HEADERS });
    }

    const { jobId } = params;

    const job = await prisma.renderJob.findUnique({
        where: { id: jobId },
        include: { shop: true }
    });

    if (!job || job.shop.shopDomain !== session.shop) {
        return json({ error: "Job not found" }, { status: 404, headers: CORS_HEADERS });
    }

    return json({
        jobId: job.id,
        status: job.status,
        imageUrl: job.imageUrl,
        errorCode: job.errorCode,
        errorMessage: job.errorMessage
    }, { headers: CORS_HEADERS });
};
