import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger, createLogContext } from "../utils/logger.server";
import {
    SEE_IT_NOW_VARIANT_LIBRARY,
    normalizeSeeItNowVariants,
    pickDefaultSelectedSeeItNowVariants,
} from "../config/see-it-now-variants.config";

/**
 * POST /api/products/regenerate-prompt
 *
 * Deprecated: the system no longer uses per-product "generated prompt mode".
 * This endpoint now resets the per-product See It Now variant selection to the default
 * 5-selected-from-10 (using shop-level variant library if configured).
 *
 * Body (JSON):
 * - productId: Shopify product ID (numeric)
 * - assetId: ProductAsset ID (UUID)
 */
export const action = async ({ request }) => {
    const requestId = `regenerate-prompt-${Date.now()}`;
    const logContext = createLogContext("api", requestId, "regenerate-prompt", {});

    try {
        const { session } = await authenticate.admin(request);
        const shopDomain = session.shop;

        const body = await request.json();
        const productId = body.productId?.toString();
        const assetId = body.assetId?.toString();

        if (!productId) {
            return json({ success: false, error: "Missing productId" }, { status: 400 });
        }

        if (!assetId) {
            return json({ success: false, error: "Missing assetId" }, { status: 400 });
        }

        // Get shop record
        const shop = await prisma.shop.findUnique({
            where: { shopDomain },
        });

        if (!shop) {
            return json({ success: false, error: "Shop not found" }, { status: 404 });
        }

        // Get asset
        const asset = await prisma.productAsset.findFirst({
            where: {
                id: assetId,
                shopId: shop.id,
                productId: productId,
            },
            select: {
                id: true,
                seeItNowVariants: true,
            },
        });

        if (!asset) {
            return json({ success: false, error: "Asset not found" }, { status: 404 });
        }

        logger.info(
            { ...logContext, assetId: asset.id, productId },
            `Resetting See It Now variants for asset ${assetId}`
        );

        // Use shop-level variant library if present, otherwise use canonical 10-option library.
        const settings = shop.settingsJson ? JSON.parse(shop.settingsJson) : {};
        const library = Array.isArray(settings?.seeItNowVariants) && settings.seeItNowVariants.length > 0
            ? normalizeSeeItNowVariants(settings.seeItNowVariants, SEE_IT_NOW_VARIANT_LIBRARY)
            : SEE_IT_NOW_VARIANT_LIBRARY;
        const selectedVariants = pickDefaultSelectedSeeItNowVariants(library);

        // Update asset with new prompt
        await prisma.productAsset.update({
            where: { id: asset.id },
            data: {
                seeItNowVariants: selectedVariants,
                updatedAt: new Date(),
            },
        });

        logger.info(
            { ...logContext, assetId: asset.id, variantCount: selectedVariants.length },
            `Successfully reset variants: ${selectedVariants.length} selected`
        );

        return json({
            success: true,
            prompt: null,
            archetype: null,
            variants: selectedVariants,
        });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(logContext, `Regenerate prompt failed: ${errorMessage}`, error);

        return json({
            success: false,
            error: errorMessage,
        }, { status: 500 });
    }
};
