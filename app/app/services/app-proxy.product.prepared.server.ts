import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { StorageService } from "../services/storage.server";
import { logger, createLogContext } from "../utils/logger.server";
import { getRequestId } from "../utils/request-context.server";
import { getCorsHeaders } from "../utils/cors.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.public.appProxy(request);
    const corsHeaders = getCorsHeaders(session?.shop ?? null);

    // Handle preflight
    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!session) {
        return json({ status: "forbidden" }, { status: 403, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const productId = url.searchParams.get("product_id");

    if (!productId) {
        return json(
            { error: "missing_product_id", message: "product_id is required" },
            { status: 400, headers: corsHeaders }
        );
    }

    const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
    if (!shop) {
        return json({ error: "Shop not found" }, { status: 404, headers: corsHeaders });
    }

    const requestId = getRequestId(request);
    const logContext = createLogContext("render", requestId, "start", {
        shopId: shop.id,
        productId
    });

    // Find the prepared product asset
    const productAsset = await prisma.productAsset.findFirst({
        where: {
            shopId: shop.id,
            productId: productId,
            status: "live",     // Only return live (enabled) assets
            enabled: true       // Double-check enabled flag
        },
        select: {
            id: true,
            preparedImageUrl: true,
            preparedImageKey: true,
            sourceImageUrl: true,
            status: true,
            // Canonical pipeline fields for dimensions
            resolvedFacts: true,
            extractedFacts: true,
            updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' }  // Get the most recent one
    });

    if (!productAsset) {
        // Product not enabled for See It
        return json(
            {
                prepared_image_url: null,
                source_image_url: null,
                status: "not_enabled",  // CHANGED: More descriptive
                message: "Product not enabled for See It visualization"
            },
            { headers: corsHeaders }
        );
    }

    // Fail-hard: prepared image must be addressable by key (no legacy URL fallbacks)
    if (!productAsset.preparedImageKey) {
        return json(
            {
                error: "no_prepared_product_image",
                message: "Prepared product image key is missing. Re-run preparation.",
                status: productAsset.status
            },
            { status: 422, headers: corsHeaders }
        );
    }

    const preparedImageUrl = await StorageService.getSignedReadUrl(
        productAsset.preparedImageKey,
        60 * 60 * 1000 // 1 hour
    );

    // Fail-hard: dimensions must come from canonical resolved facts only
    type CanonicalFacts = { typical_dimensions_cm?: { width?: number; height?: number } } | null;
    const resolvedFacts = productAsset.resolvedFacts as CanonicalFacts;
    const dimensions = resolvedFacts?.typical_dimensions_cm || null;
    if (!dimensions) {
        return json(
            {
                error: "pipeline_not_ready",
                message: "Resolved facts missing dimensions. Re-run preparation.",
                status: productAsset.status
            },
            { status: 422, headers: corsHeaders }
        );
    }

    logger.debug(
        { ...logContext, stage: "prepared-product-url" },
        `Generated prepared image URL from key: ${productAsset.preparedImageKey}`
    );

    return json(
        {
            prepared_image_url: preparedImageUrl,
            source_image_url: null,
            status: productAsset.status,
            dimensions: dimensions,  // Real product dimensions (cm) for correct aspect ratio
        },
        { headers: corsHeaders }
    );
};

