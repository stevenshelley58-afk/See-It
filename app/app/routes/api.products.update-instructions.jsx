import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger, createLogContext } from "../utils/logger.server";
import { emitPrepEvent } from "../services/prep-events.server";
import { setSeeItLiveTag } from "../utils/shopify-tags.server";
import {
    buildPromptPack,
    ensurePromptVersion,
    resolveProductFacts,
} from "../services/see-it-now/index";

/**
 * POST /api/products/update-instructions
 *
 * Update custom render instructions, placement fields, and See It Now placement rules for a product asset
 *
 * Body (FormData):
 * - productId: Shopify product ID (numeric)
 * - instructions: Placement prompt (prose text for AI render, can be empty string to clear)
 * - placementFields: (optional) JSON string with structured fields: { surface, material, orientation, shadow, dimensions: { height, width }, additionalNotes }
 * - sceneRole: (optional) "Dominant" | "Integrated"
 * - replacementRule: (optional) "Same Role Only" | "Similar Size or Position" | "Any Blocking Object" | "None"
 * - allowSpaceCreation: (optional) "true" | "false"
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
        const instructions = formData.get("instructions")?.toString() ?? "";
        
        // Extract instructionsSeeItNow (3-state: missing = no change, empty = null, value = trimmed text)
        let instructionsSeeItNow = undefined;
        if (formData.has("instructionsSeeItNow")) {
            const raw = formData.get("instructionsSeeItNow")?.toString() ?? "";
            instructionsSeeItNow = raw.trim() || null;
        }
        
        // Extract placementFields (JSON)
        let placementFields = null;
        const placementFieldsRaw = formData.get("placementFields")?.toString();
        if (placementFieldsRaw) {
            try {
                placementFields = JSON.parse(placementFieldsRaw);
                // Validate structure
                if (typeof placementFields !== 'object' || placementFields === null) {
                    return json({ success: false, error: "placementFields must be a valid JSON object" }, { status: 400 });
                }
            } catch (e) {
                return json({ success: false, error: "Invalid placementFields JSON format" }, { status: 400 });
            }
        }
        
        // Extract placement rules
        const sceneRole = formData.get("sceneRole")?.toString() || null;
        const replacementRule = formData.get("replacementRule")?.toString() || null;
        const allowSpaceCreationRaw = formData.get("allowSpaceCreation")?.toString();
        const allowSpaceCreation = allowSpaceCreationRaw === 'true' ? true : allowSpaceCreationRaw === 'false' ? false : null;

        // Extract enabled field for ready ↔ live transitions
        const enabledRaw = formData.get("enabled")?.toString();
        const enabled = enabledRaw === 'true' ? true : enabledRaw === 'false' ? false : null;

        // Extract See It Now generated prompt fields
        let generatedSeeItNowPrompt = undefined;
        if (formData.has("generatedSeeItNowPrompt")) {
            const raw = formData.get("generatedSeeItNowPrompt")?.toString() ?? "";
            generatedSeeItNowPrompt = raw.trim() || null;
        }

        // NEW: Merchant overrides (sparse diff) for See It Now v2 pipeline
        // 3-state semantics:
        // - missing field => no change
        // - empty string => null (clear)
        // - JSON object => set
        let merchantOverrides = undefined;
        if (formData.has("merchantOverrides")) {
            const raw = formData.get("merchantOverrides")?.toString();
            if (!raw || raw.trim() === "") {
                merchantOverrides = null;
            } else {
                try {
                    merchantOverrides = JSON.parse(raw);
                    if (
                        merchantOverrides === null ||
                        typeof merchantOverrides !== "object" ||
                        Array.isArray(merchantOverrides)
                    ) {
                        return json(
                            { success: false, error: "merchantOverrides must be a JSON object" },
                            { status: 400 }
                        );
                    }
                } catch (e) {
                    return json(
                        { success: false, error: "Invalid merchantOverrides JSON format" },
                        { status: 400 }
                    );
                }
            }
        }

        let seeItNowVariants = undefined;
        if (formData.has("seeItNowVariants")) {
            const variantsRaw = formData.get("seeItNowVariants")?.toString();
            if (variantsRaw) {
                try {
                    seeItNowVariants = JSON.parse(variantsRaw);
                    // Validate it's an array
                    if (!Array.isArray(seeItNowVariants)) {
                        return json({ success: false, error: "seeItNowVariants must be a valid JSON array" }, { status: 400 });
                    }
                } catch (e) {
                    return json({ success: false, error: "Invalid seeItNowVariants JSON format" }, { status: 400 });
                }
            } else {
                seeItNowVariants = null;
            }
        }

        const useGeneratedPromptRaw = formData.get("useGeneratedPrompt")?.toString();
        const useGeneratedPrompt = useGeneratedPromptRaw === 'true' ? true : useGeneratedPromptRaw === 'false' ? false : undefined;

        if (!productId) {
            return json({ success: false, error: "Missing productId" }, { status: 400 });
        }
        
        // Validate placement rules
        const validSceneRoles = ['Dominant', 'Integrated'];
        if (sceneRole && !validSceneRoles.includes(sceneRole)) {
            return json({ success: false, error: `Invalid sceneRole. Must be one of: ${validSceneRoles.join(', ')}` }, { status: 400 });
        }
        
        const validReplacementRules = ['Same Role Only', 'Similar Size or Position', 'Any Blocking Object', 'None'];
        if (replacementRule && !validReplacementRules.includes(replacementRule)) {
            return json({ success: false, error: `Invalid replacementRule. Must be one of: ${validReplacementRules.join(', ')}` }, { status: 400 });
        }

        logger.info(logContext, `Update instructions: productId=${productId}, length=${instructions.length}, hasPlacementFields=${!!placementFields}, sceneRole=${sceneRole}, replacementRule=${replacementRule}, allowSpaceCreation=${allowSpaceCreation}, enabled=${enabled}`);

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
        
        // Add renderInstructionsSeeItNow if provided (3-state semantics)
        if (instructionsSeeItNow !== undefined) {
            updateData.renderInstructionsSeeItNow = instructionsSeeItNow;
        }
        
        // Add placementFields if provided (mark all fields as merchant-owned when saved)
        if (placementFields !== null) {
            // Mark all fields in placementFields as merchant-owned
            const placementFieldsWithSource = {
                ...placementFields,
                fieldSource: {}
            };
            // Mark each field as merchant-owned
            const fieldsToMark = ['surface', 'material', 'orientation', 'shadow', 'dimensions', 'additionalNotes'];
            fieldsToMark.forEach(field => {
                if (placementFields.hasOwnProperty(field)) {
                    placementFieldsWithSource.fieldSource[field] = 'merchant';
                }
            });
            updateData.placementFields = placementFieldsWithSource;
        }
        
        // Add placement rules if provided (also mark as merchant-owned when explicitly set)
        if (sceneRole !== null) {
            updateData.sceneRole = sceneRole;
        }
        if (replacementRule !== null) {
            updateData.replacementRule = replacementRule;
        }
        if (allowSpaceCreation !== null) {
            updateData.allowSpaceCreation = allowSpaceCreation;
        }
        
        // Mark placement rules as merchant-owned in fieldSource when explicitly set
        if (sceneRole !== null || replacementRule !== null || allowSpaceCreation !== null) {
            const existingFieldSource = asset?.fieldSource ? (typeof asset.fieldSource === 'object' ? asset.fieldSource : {}) : {};
            const updatedFieldSource = { ...existingFieldSource };
            if (sceneRole !== null) updatedFieldSource.sceneRole = 'merchant';
            if (replacementRule !== null) updatedFieldSource.replacementRule = 'merchant';
            if (allowSpaceCreation !== null) updatedFieldSource.allowSpaceCreation = 'merchant';
            updateData.fieldSource = updatedFieldSource;
        }

        // Add See It Now generated prompt fields if provided
        if (generatedSeeItNowPrompt !== undefined) {
            updateData.generatedSeeItNowPrompt = generatedSeeItNowPrompt;
        }
        if (seeItNowVariants !== undefined) {
            updateData.seeItNowVariants = seeItNowVariants;
        }
        if (useGeneratedPrompt !== undefined) {
            updateData.useGeneratedPrompt = useGeneratedPrompt;
        }
        if (merchantOverrides !== undefined) {
            updateData.merchantOverrides = merchantOverrides;
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
            // Only sync if we're actually transitioning to/from live status
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

            // Emit merchant_placement_saved event for newly created asset
            await emitPrepEvent(
                {
                    assetId: asset.id,
                    productId: productId,
                    shopId: shop.id,
                    eventType: "merchant_placement_saved",
                    actorType: "merchant",
                    payload: {
                        renderInstructions: instructions.trim() || undefined,
                        renderInstructionsSeeItNow: instructionsSeeItNow !== undefined ? instructionsSeeItNow || undefined : undefined,
                        placementFields: placementFields || undefined,
                        sceneRole: sceneRole || undefined,
                        replacementRule: replacementRule || undefined,
                        allowSpaceCreation: allowSpaceCreation !== null ? allowSpaceCreation : undefined,
                        isNewAsset: true,
                    },
                },
                session,
                requestId
            ).catch(() => {
                // Non-critical
            });

            // If merchantOverrides were provided, attempt to rebuild v2 prompt pack immediately.
            if (merchantOverrides !== undefined) {
                try {
                    if (!asset.extractedFacts) {
                        return json({
                            success: true,
                            message:
                                "Saved. See It Now facts are not extracted yet; prompt pack will generate after preparation.",
                            assetId: asset.id,
                            status: asset.status,
                            enabled: asset.enabled || false,
                            pipelineUpdated: false,
                            pipelineStatus: "missing_extracted_facts",
                        });
                    }
                    const promptPackVersion = await ensurePromptVersion();
                    const resolvedFacts = resolveProductFacts(
                        asset.extractedFacts,
                        asset.merchantOverrides || null
                    );
                    const promptPack = await buildPromptPack(resolvedFacts, requestId);
                    await prisma.productAsset.update({
                        where: { id: asset.id },
                        data: {
                            resolvedFacts,
                            promptPack,
                            promptPackVersion,
                        },
                    });
                    return json({
                        success: true,
                        message: "Saved and regenerated See It Now prompt pack",
                        assetId: asset.id,
                        status: asset.status,
                        enabled: asset.enabled || false,
                        pipelineUpdated: true,
                        promptPackVersion,
                    });
                } catch (e) {
                    const msg = e instanceof Error ? e.message : "Unknown error";
                    return json(
                        {
                            success: false,
                            error: `Saved placement fields, but failed to regenerate See It Now prompt pack: ${msg}`,
                        },
                        { status: 500 }
                    );
                }
            }

            return json({
                success: true,
                message: "Instructions saved (new asset created)",
                assetId: asset.id,
                status: asset.status,
                enabled: asset.enabled || false,
            });
        }

        // Capture before state for diff (if needed)
        const beforeState = {
            renderInstructions: asset.renderInstructions,
            renderInstructionsSeeItNow: asset.renderInstructionsSeeItNow,
            placementFields: asset.placementFields,
            sceneRole: asset.sceneRole,
            replacementRule: asset.replacementRule,
            allowSpaceCreation: asset.allowSpaceCreation,
        };

        // Update existing asset
        const updatedAsset = await prisma.productAsset.update({
            where: { id: asset.id },
            data: updateData,
        });

        logger.info(
            { ...logContext, stage: "updated" },
            `Updated instructions for asset ${asset.id}`
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
                    renderInstructions: instructions.trim() || undefined,
                    renderInstructionsSeeItNow: instructionsSeeItNow !== undefined ? instructionsSeeItNow || undefined : undefined,
                    placementFields: placementFields || undefined,
                    sceneRole: sceneRole || undefined,
                    replacementRule: replacementRule || undefined,
                    allowSpaceCreation: allowSpaceCreation !== null ? allowSpaceCreation : undefined,
                    before: beforeState.renderInstructions !== instructions.trim() || instructionsSeeItNow !== undefined || placementFields !== null || sceneRole !== null || replacementRule !== null || allowSpaceCreation !== null
                        ? {
                            renderInstructions: beforeState.renderInstructions || undefined,
                            renderInstructionsSeeItNow: instructionsSeeItNow !== undefined ? (beforeState.renderInstructionsSeeItNow || undefined) : undefined,
                            placementFields: beforeState.placementFields ? (typeof beforeState.placementFields === 'object' ? beforeState.placementFields : undefined) : undefined,
                            sceneRole: beforeState.sceneRole || undefined,
                            replacementRule: beforeState.replacementRule || undefined,
                            allowSpaceCreation: beforeState.allowSpaceCreation !== null ? beforeState.allowSpaceCreation : undefined,
                        }
                        : undefined,
                },
            },
            session,
            requestId
        ).catch(() => {
            // Non-critical
        });

        // If merchantOverrides were provided, regenerate See It Now v2 prompt pack immediately.
        if (merchantOverrides !== undefined) {
            try {
                if (!updatedAsset.extractedFacts) {
                    return json({
                        success: true,
                        message:
                            "Saved. See It Now facts are not extracted yet; prompt pack will generate after preparation.",
                        assetId: asset.id,
                        status: updatedAsset.status,
                        enabled: updatedAsset.enabled,
                        pipelineUpdated: false,
                        pipelineStatus: "missing_extracted_facts",
                    });
                }

                const promptPackVersion = await ensurePromptVersion();
                const resolvedFacts = resolveProductFacts(
                    updatedAsset.extractedFacts,
                    updatedAsset.merchantOverrides || null
                );
                const promptPack = await buildPromptPack(resolvedFacts, requestId);

                await prisma.productAsset.update({
                    where: { id: asset.id },
                    data: {
                        resolvedFacts,
                        promptPack,
                        promptPackVersion,
                    },
                });

                return json({
                    success: true,
                    message: "Saved and regenerated See It Now prompt pack",
                    assetId: asset.id,
                    status: updatedAsset.status,
                    enabled: updatedAsset.enabled,
                    pipelineUpdated: true,
                    promptPackVersion,
                });
            } catch (e) {
                const msg = e instanceof Error ? e.message : "Unknown error";
                return json(
                    {
                        success: false,
                        error: `Saved placement fields, but failed to regenerate See It Now prompt pack: ${msg}`,
                    },
                    { status: 500 }
                );
            }
        }

        return json({
            success: true,
            message: "Instructions saved",
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

