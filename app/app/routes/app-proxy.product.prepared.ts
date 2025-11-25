import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
    // Handle preflight
    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
        return json({ status: "forbidden" }, { status: 403, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const productId = url.searchParams.get("product_id");

    if (!productId) {
        return json(
            { error: "missing_product_id", message: "product_id is required" },
            { status: 400, headers: CORS_HEADERS }
        );
    }

    const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
    if (!shop) {
        return json({ error: "Shop not found" }, { status: 404, headers: CORS_HEADERS });
    }

    // Find the prepared product asset
    const productAsset = await prisma.productAsset.findFirst({
        where: { 
            shopId: shop.id, 
            productId: productId,
            status: "ready"  // Only return ready (prepared) assets
        },
        orderBy: { updatedAt: 'desc' }  // Get the most recent one
    });

    if (!productAsset || !productAsset.preparedImageUrl) {
        // No prepared image available - return null so frontend can fallback
        return json(
            { 
                prepared_image_url: null,
                source_image_url: productAsset?.sourceImageUrl || null,
                status: productAsset?.status || "not_found"
            },
            { headers: CORS_HEADERS }
        );
    }

    return json(
        { 
            prepared_image_url: productAsset.preparedImageUrl,
            source_image_url: productAsset.sourceImageUrl,
            status: productAsset.status
        },
        { headers: CORS_HEADERS }
    );
};

