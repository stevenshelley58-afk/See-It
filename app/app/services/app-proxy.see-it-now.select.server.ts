import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { StorageService } from "../services/storage.server";
import { logger, createLogContext } from "../utils/logger.server";
import { getRequestId } from "../utils/request-context.server";
import { isSeeItNowAllowedShop } from "~/utils/see-it-now-allowlist.server";
import { getCorsHeaders } from "../utils/cors.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const requestId = getRequestId(request);
    const logContext = createLogContext("render", requestId, "select", {
        version: "see-it-now-v2",
    });

    const { session } = await authenticate.public.appProxy(request);
    const corsHeaders = getCorsHeaders(session?.shop ?? null);

    // Handle preflight
    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!session) {
        return json({ status: "forbidden" }, { status: 403, headers: corsHeaders });
    }

    // Allowlist check
    if (!isSeeItNowAllowedShop(session.shop)) {
        return json(
            { error: "see_it_now_not_enabled", message: "See It Now is not enabled for this shop" },
            { status: 403, headers: corsHeaders }
        );
    }

    let body: {
        product_id?: string;
        room_session_id?: string;
        run_id?: string;
        variant_id?: string;
        image_url?: string;
    };

    try {
        body = await request.json();
    } catch {
        return json(
            { error: "invalid_json", message: "Request body must be valid JSON" },
            { status: 400, headers: corsHeaders }
        );
    }

    const { product_id, room_session_id, run_id, variant_id, image_url } = body;

    if (!product_id) {
        return json(
            { error: "missing_product_id", message: "product_id is required" },
            { status: 400, headers: corsHeaders }
        );
    }

    if (!room_session_id) {
        return json(
            { error: "missing_room_session_id", message: "room_session_id is required" },
            { status: 400, headers: corsHeaders }
        );
    }

    if (!run_id) {
        return json(
            { error: "missing_run_id", message: "run_id is required" },
            { status: 400, headers: corsHeaders }
        );
    }

    if (!variant_id) {
        return json(
            { error: "missing_variant_id", message: "variant_id is required" },
            { status: 400, headers: corsHeaders }
        );
    }

    if (!image_url) {
        return json(
            { error: "missing_image_url", message: "image_url is required" },
            { status: 400, headers: corsHeaders }
        );
    }

    // Lookup shop
    const shop = await prisma.shop.findUnique({
        where: { shopDomain: session.shop },
        select: { id: true },
    });
    if (!shop) {
        return json({ error: "shop_not_found", message: "Shop not found" }, { status: 404, headers: corsHeaders });
    }

    // Verify composite run and variant belong to this shop/product/room
    const run = await prisma.compositeRun.findFirst({
        where: {
            id: run_id,
            shopId: shop.id,
            productId: product_id,
            roomSessionId: room_session_id,
        },
        select: { id: true },
    });
    if (!run) {
        return json(
            { error: "run_not_found", message: "Run not found" },
            { status: 404, headers: corsHeaders }
        );
    }

    const variant = await prisma.compositeVariant.findFirst({
        where: {
            compositeRunId: run.id,
            variantId: variant_id,
        },
        select: {
            id: true,
            compositeRunId: true,
            variantId: true,
            imageRef: true,
        },
    });
    if (!variant) {
        return json(
            { error: "variant_not_found", message: "Variant not found" },
            { status: 404, headers: corsHeaders }
        );
    }

    // Fail-hard: selection must correspond to persisted imageRef (no trusting client image_url)
    if (!variant.imageRef) {
        return json(
            { error: "variant_missing_image", message: "Variant has no stored imageRef" },
            { status: 422, headers: corsHeaders }
        );
    }

    // Store selection
    await prisma.selection.create({
        data: {
            shopId: shop.id,
            productId: product_id,
            roomSessionId: room_session_id,
            compositeRunId: run.id,
            compositeVariantId: variant.id,
            variantId: variant_id,
            selectedImageUrl: image_url,
            createdAt: new Date(),
        },
    });

    logger.info(
        { ...logContext, stage: "selected", shopId: shop.id, runId: run.id, variantId: variant_id },
        `[See It Now] Selected variant ${variant_id} for run ${run_id}`
    );

    // Fail-hard: no implicit upscaling fallback. If you want upscales, build it as a real pipeline stage.
    return json(
        {
            ok: true,
            message: "Selection recorded",
        },
        { headers: corsHeaders }
    );
};

