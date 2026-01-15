import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger, createLogContext } from "../utils/logger.server";
import { generateSeeItNowPrompt } from "../services/see-it-now-prompt-generator.server";

/**
 * POST /api/products/regenerate-prompt
 * 
 * Manually regenerate the See It Now prompt for a product asset.
 * This allows merchants to regenerate prompts from the UI.
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
                productTitle: true,
                productType: true,
                placementFields: true,
            },
        });

        if (!asset) {
            return json({ success: false, error: "Asset not found" }, { status: 404 });
        }

        logger.info(
            { ...logContext, assetId: asset.id, productId },
            `Regenerating See It Now prompt for asset ${assetId}`
        );

        // Build product data for prompt generation
        const placementFields = asset.placementFields && typeof asset.placementFields === 'object'
            ? asset.placementFields
            : null;

        const productData = {
            title: asset.productTitle || '',
            description: '', // Not available in this context
            productType: asset.productType || undefined,
            vendor: undefined,
            tags: [],
            dimensions: placementFields?.dimensions || undefined,
            placementFields: placementFields || undefined,
        };

        // Generate prompt
        const promptResult = await generateSeeItNowPrompt(productData, requestId);

        // Update asset with new prompt
        await prisma.productAsset.update({
            where: { id: asset.id },
            data: {
                generatedSeeItNowPrompt: promptResult.productPrompt,
                seeItNowVariants: promptResult.selectedVariants,
                detectedArchetype: promptResult.archetype,
                // useGeneratedPrompt stays as-is (merchant controls this separately)
                updatedAt: new Date(),
            },
        });

        logger.info(
            { ...logContext, assetId: asset.id, archetype: promptResult.archetype, variantCount: promptResult.selectedVariants.length },
            `Successfully regenerated prompt: archetype=${promptResult.archetype}, ${promptResult.selectedVariants.length} variants`
        );

        return json({
            success: true,
            prompt: promptResult.productPrompt,
            archetype: promptResult.archetype,
            variants: promptResult.selectedVariants,
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
