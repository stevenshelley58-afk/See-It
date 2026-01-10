import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { StorageService } from "../services/storage.server";
import { logger, createLogContext } from "../utils/logger.server";
import { getRequestId } from "../utils/request-context.server";

function getCorsHeaders(shopDomain: string | null): Record<string, string> {
    // Only set CORS origin if we have a valid shop domain
    // Empty origin or "*" would be a security risk
    const headers: Record<string, string> = {
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        // Prevent caching to ensure fresh signed URLs are always returned
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
    };
    
    if (shopDomain) {
        headers["Access-Control-Allow-Origin"] = `https://${shopDomain}`;
    }
    
    return headers;
}

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
    const logContext = createLogContext("product-prepared", requestId, "start", {
        shopId: shop.id,
        productId
    });

    // Find the prepared product asset
    const productAsset = await prisma.productAsset.findFirst({
        where: {
            shopId: shop.id,
            productId: productId,
            status: "live",     // CHANGED: Only return live (enabled) assets
            enabled: true       // ADDED: Double-check enabled flag
        },
        select: {
            id: true,
            preparedImageUrl: true,
            preparedImageKey: true,
            sourceImageUrl: true,
            status: true,
            placementFields: true,  // Include dimensions for correct aspect ratio
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

    // Generate fresh signed URL from stored key (prevents 403 from expired URLs)
    let preparedImageUrl: string | null = null;

    if (productAsset.preparedImageKey) {
        try {
            // Generate fresh signed URL with 1-hour TTL
            preparedImageUrl = await StorageService.getSignedReadUrl(
                productAsset.preparedImageKey,
                60 * 60 * 1000 // 1 hour
            );
            logger.debug(
                { ...logContext, stage: "url-generation" },
                `Generated fresh signed URL from key: ${productAsset.preparedImageKey}`
            );
        } catch (error) {
            logger.error(
                { ...logContext, stage: "url-generation-error" },
                "Failed to generate signed URL from key, falling back to stored URL",
                error
            );
            // Fall back to stored URL if key-based generation fails
            preparedImageUrl = productAsset.preparedImageUrl;
        }
    } else if (productAsset.preparedImageUrl) {
        // Legacy: use stored URL if no key available
        // Note: This URL may be expired for older assets
        preparedImageUrl = productAsset.preparedImageUrl;
        logger.debug(
            { ...logContext, stage: "url-legacy" },
            "Using stored URL (no key available - legacy asset)"
        );
    }

    if (!preparedImageUrl) {
        return json(
            {
                prepared_image_url: null,
                source_image_url: productAsset.sourceImageUrl || null,
                status: productAsset.status
            },
            { headers: corsHeaders }
        );
    }

    // Extract dimensions from placementFields if available
    const placementFields = productAsset.placementFields as { dimensions?: { width?: number; height?: number } } | null;
    const dimensions = placementFields?.dimensions || null;

    return json(
        {
            prepared_image_url: preparedImageUrl,
            source_image_url: productAsset.sourceImageUrl,
            status: productAsset.status,
            dimensions: dimensions,  // Real product dimensions (cm) for correct aspect ratio
        },
        { headers: corsHeaders }
    );
};

