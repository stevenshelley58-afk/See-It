import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger, createLogContext } from "../utils/logger.server";

/**
 * POST /api/products/update-instructions
 *
 * Update custom render instructions for a product asset
 *
 * Body (FormData):
 * - productId: Shopify product ID (numeric)
 * - instructions: Custom AI instructions for final render (can be empty string to clear)
 */
export const action = async ({ request }) => {
    const requestId = `update-instructions-${Date.now()}`;
    const logContext = createLogContext("api", requestId, "update-instructions", {});

    try {
        const { session } = await authenticate.admin(request);
        const shopDomain = session.shop;

        const formData = await request.formData();
        const productId = formData.get("productId")?.toString();
        const instructions = formData.get("instructions")?.toString() ?? "";

        if (!productId) {
            return json({ success: false, error: "Missing productId" }, { status: 400 });
        }

        logger.info(logContext, `Update instructions: productId=${productId}, length=${instructions.length}`);

        // Get shop record
        const shop = await prisma.shop.findUnique({
            where: { shopDomain },
        });

        if (!shop) {
            return json({ success: false, error: "Shop not found" }, { status: 404 });
        }

        // Get existing asset - or create placeholder if none exists
        let asset = await prisma.productAsset.findFirst({
            where: {
                shopId: shop.id,
                productId: productId,
            },
        });

        if (!asset) {
            // No asset exists yet - create a minimal one to store instructions
            // This allows setting instructions before background removal
            asset = await prisma.productAsset.create({
                data: {
                    shopId: shop.id,
                    productId: productId,
                    sourceImageId: "pending",
                    sourceImageUrl: "pending",
                    status: "pending",
                    prepStrategy: "manual",
                    promptVersion: 1,
                    renderInstructions: instructions.trim() || null,
                    createdAt: new Date(),
                },
            });

            logger.info(
                { ...logContext, stage: "created" },
                `Created new asset with instructions for product ${productId}`
            );

            return json({
                success: true,
                message: "Instructions saved (new asset created)",
                assetId: asset.id,
            });
        }

        // Update existing asset
        await prisma.productAsset.update({
            where: { id: asset.id },
            data: {
                renderInstructions: instructions.trim() || null,
                updatedAt: new Date(),
            },
        });

        logger.info(
            { ...logContext, stage: "updated" },
            `Updated instructions for asset ${asset.id}`
        );

        return json({
            success: true,
            message: "Instructions saved",
            assetId: asset.id,
        });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(logContext, `Update instructions failed: ${errorMessage}`, error);

        return json({
            success: false,
            error: errorMessage,
        }, { status: 500 });
    }
};

