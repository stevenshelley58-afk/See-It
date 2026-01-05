import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger, createLogContext } from "../utils/logger.server";

/**
 * POST /api/products/update-instructions
 *
 * Update custom render instructions and v2 config for a product asset
 *
 * Body (FormData):
 * - productId: Shopify product ID (numeric)
 * - instructions: Custom AI instructions for final render (can be empty string to clear)
 * - sceneRole: (optional) "Dominant" | "Integrated"
 * - replacementRule: (optional) "Same Role Only" | "Similar Size or Position" | "Any Blocking Object" | "None"
 * - allowSpaceCreation: (optional) "true" | "false"
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
        
        // Extract v2 fields
        const sceneRole = formData.get("sceneRole")?.toString() || null;
        const replacementRule = formData.get("replacementRule")?.toString() || null;
        const allowSpaceCreationRaw = formData.get("allowSpaceCreation")?.toString();
        const allowSpaceCreation = allowSpaceCreationRaw === 'true' ? true : allowSpaceCreationRaw === 'false' ? false : null;

        if (!productId) {
            return json({ success: false, error: "Missing productId" }, { status: 400 });
        }
        
        // Validate v2 fields
        const validSceneRoles = ['Dominant', 'Integrated'];
        if (sceneRole && !validSceneRoles.includes(sceneRole)) {
            return json({ success: false, error: `Invalid sceneRole. Must be one of: ${validSceneRoles.join(', ')}` }, { status: 400 });
        }
        
        const validReplacementRules = ['Same Role Only', 'Similar Size or Position', 'Any Blocking Object', 'None'];
        if (replacementRule && !validReplacementRules.includes(replacementRule)) {
            return json({ success: false, error: `Invalid replacementRule. Must be one of: ${validReplacementRules.join(', ')}` }, { status: 400 });
        }

        logger.info(logContext, `Update instructions: productId=${productId}, length=${instructions.length}, sceneRole=${sceneRole}, replacementRule=${replacementRule}, allowSpaceCreation=${allowSpaceCreation}`);

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

        // Prepare update data
        const updateData = {
            renderInstructions: instructions.trim() || null,
            updatedAt: new Date(),
        };
        
        // Add v2 fields if provided
        if (sceneRole !== null) {
            updateData.sceneRole = sceneRole;
        }
        if (replacementRule !== null) {
            updateData.replacementRule = replacementRule;
        }
        if (allowSpaceCreation !== null) {
            updateData.allowSpaceCreation = allowSpaceCreation;
        }

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
                    ...updateData,
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
            data: updateData,
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

