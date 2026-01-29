import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger, createLogContext } from "../utils/logger.server";
import { emitPrepEvent } from "../services/prep-events.server";
import { setSeeItLiveTag } from "../utils/shopify-tags.server";
import { resolveProductFacts, buildPlacementSet } from "../services/see-it-now/index";

/**
 * POST /api/products/update-instructions
 *
 * Update enabled status for a product asset.
 *
 * Body (FormData):
 * - productId: Shopify product ID (numeric) - required
 * - enabled: (optional) "true" | "false" - Controls ready ↔ live status transitions
 */
export const action = async ({ request }) => {
    const requestId = `update-instructions-${Date.now()}`;
    const logContext = createLogContext("api", requestId, "update-instructions", {});

    try {
        const { session, admin } = await authenticate.admin(request);
        const shopDomain = session.shop;

        const formData = await request.formData();
        const productId = formData.get("productId")?.toString();

        // Extract enabled field for ready ↔ live transitions
        const enabledRaw = formData.get("enabled")?.toString();
        const enabled = enabledRaw === 'true' ? true : enabledRaw === 'false' ? false : null;

        // Extract placement fields for merchantOverrides
        const dimensionHeightProvided = formData.has("dimensionHeight");
        const dimensionWidthProvided = formData.has("dimensionWidth");
        const materialProvided = formData.has("material");

        const dimensionHeightRaw = dimensionHeightProvided
            ? formData.get("dimensionHeight")?.toString()
            : undefined;
        const dimensionWidthRaw = dimensionWidthProvided
            ? formData.get("dimensionWidth")?.toString()
            : undefined;
        const materialRaw = materialProvided ? formData.get("material")?.toString() : undefined;

        // If a field is provided but empty, we treat it as "clear this override"
        const dimensionHeight = dimensionHeightRaw && dimensionHeightRaw.trim() !== ""
            ? parseFloat(dimensionHeightRaw)
            : null;
        const dimensionWidth = dimensionWidthRaw && dimensionWidthRaw.trim() !== ""
            ? parseFloat(dimensionWidthRaw)
            : null;
        const material = materialRaw && materialRaw.trim() !== "" ? materialRaw.trim() : null;

        if (
            (dimensionHeightRaw && dimensionHeightRaw.trim() !== "" && !Number.isFinite(dimensionHeight)) ||
            (dimensionWidthRaw && dimensionWidthRaw.trim() !== "" && !Number.isFinite(dimensionWidth))
        ) {
            return json({ success: false, error: "Invalid dimensions" }, { status: 400 });
        }

        if (!productId) {
            return json({ success: false, error: "Missing productId" }, { status: 400 });
        }

        logger.info(logContext, `Update instructions: productId=${productId}, enabled=${enabled}, dimensions=${dimensionHeight}x${dimensionWidth}, material=${material}`);

        // Get shop record
        const shop = await prisma.shop.findUnique({
            where: { shopDomain },
        });

        if (!shop) {
            return json({ success: false, error: "Shop not found" }, { status: 404 });
        }

        // Get existing asset
        let asset = await prisma.productAsset.findFirst({
            where: {
                shopId: shop.id,
                productId: productId,
            },
        });

        // Prepare update data
        const updateData = {
            updatedAt: new Date(),
        };

        // Build merchantOverrides if any placement fields changed
        const hasDimensions = dimensionHeightProvided || dimensionWidthProvided;
        const hasMaterial = materialProvided;
        const shouldUpdateOverrides = hasDimensions || hasMaterial;

        let nextOverrides = null;

        if (shouldUpdateOverrides) {
            // Get existing merchantOverrides to merge
            const existingOverrides = asset?.merchantOverrides && typeof asset.merchantOverrides === 'object'
                ? asset.merchantOverrides
                : {};

            const newOverrides = { ...existingOverrides };

            if (hasDimensions) {
                const existingDims = (existingOverrides.dimensions_cm && typeof existingOverrides.dimensions_cm === 'object')
                    ? { ...existingOverrides.dimensions_cm }
                    : {};

                const dims = { ...existingDims };

                if (dimensionHeightProvided) {
                    if (dimensionHeight === null) delete dims.h;
                    else dims.h = dimensionHeight;
                }

                if (dimensionWidthProvided) {
                    if (dimensionWidth === null) delete dims.w;
                    else dims.w = dimensionWidth;
                }

                if (Object.keys(dims).length === 0) {
                    delete newOverrides.dimensions_cm;
                } else {
                    newOverrides.dimensions_cm = dims;
                }
            }

            if (hasMaterial) {
                const existingMaterial = (existingOverrides.material_profile && typeof existingOverrides.material_profile === 'object')
                    ? { ...existingOverrides.material_profile }
                    : {};

                const materialProfile = { ...existingMaterial };

                if (material === null) {
                    delete materialProfile.primary;
                } else {
                    materialProfile.primary = material;
                }

                if (Object.keys(materialProfile).length === 0) {
                    delete newOverrides.material_profile;
                } else {
                    newOverrides.material_profile = materialProfile;
                }
            }

            nextOverrides = newOverrides;
            updateData.merchantOverrides = newOverrides;
        }

        // If the merchant updated overrides and we have extractedFacts, rebuild resolvedFacts + placementSet
        // so storefront renders use the updated pipeline data immediately.
        if (asset && shouldUpdateOverrides && asset.extractedFacts) {
            const resolvedFacts = resolveProductFacts(asset.extractedFacts, nextOverrides);
            const placementSet = await buildPlacementSet({
                resolvedFacts,
                productAssetId: asset.id,
                shopId: shop.id,
                traceId: requestId,
            });

            updateData.resolvedFacts = resolvedFacts;
            updateData.placementSet = placementSet;
        }

        // Handle enabled toggle and status transitions
        if (enabled !== null && asset) {
            const currentStatus = asset.status;
            updateData.enabled = enabled;

            // Status transitions based on enabled flag
            if (enabled && currentStatus === "ready") {
                // Enabling: ready → live
                updateData.status = "live";
            } else if (!enabled && currentStatus === "live") {
                // Disabling: live → ready
                updateData.status = "ready";
            }
            // If status is not ready/live, don't change it (e.g., preparing, failed, pending)

            // Sync "see-it-live" tag to Shopify product so storefront can conditionally show button
            if (updateData.status === "live" || (currentStatus === "live" && !enabled)) {
                const tagResult = await setSeeItLiveTag(admin, productId, enabled);
                if (!tagResult.success) {
                    logger.warn(
                        { ...logContext, stage: "tag-sync-warning" },
                        `Failed to sync product tag (non-blocking): ${tagResult.error}`
                    );
                }
            }

            // Emit event for monitor
            await emitPrepEvent(
                {
                    assetId: asset.id,
                    productId: productId,
                    shopId: shop.id,
                    eventType: enabled ? "product_enabled" : "product_disabled",
                    actorType: "merchant",
                    payload: {
                        enabled: enabled,
                        previousStatus: currentStatus,
                        newStatus: updateData.status || currentStatus,
                    },
                },
                session,
                requestId
            ).catch((err) => {
                console.error("Failed to emit prep event:", err);
            });
        }

        if (!asset) {
            // No asset exists yet - create a minimal one
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
                `Created new asset for product ${productId}`
            );

            return json({
                success: true,
                message: "Asset created",
                assetId: asset.id,
                status: asset.status,
                enabled: asset.enabled || false,
            });
        }

        // Update existing asset
        const updatedAsset = await prisma.productAsset.update({
            where: { id: asset.id },
            data: updateData,
        });

        logger.info(
            { ...logContext, stage: "updated" },
            `Updated asset ${asset.id}`
        );

        // Emit merchant_placement_saved event
        await emitPrepEvent(
            {
                assetId: asset.id,
                productId: productId,
                shopId: shop.id,
                eventType: "merchant_placement_saved",
                actorType: "merchant",
                payload: {
                    enabled: enabled !== null ? enabled : undefined,
                    merchantOverrides: updateData.merchantOverrides || undefined,
                },
            },
            session,
            requestId
        ).catch(() => {
            // Non-critical
        });

        return json({
            success: true,
            message: "Saved",
            assetId: asset.id,
            status: updatedAsset.status,
            enabled: updatedAsset.enabled,
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
