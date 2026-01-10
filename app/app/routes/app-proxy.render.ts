// Render endpoint - v1.0.19 - Added Cache-Control headers, imageKey storage, and immediate completion response
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { checkQuota, incrementQuota } from "../quota.server";
import { checkRateLimit } from "../rate-limit.server";
import { compositeScene, type CompositeOptions } from "../services/gemini.server";
import { StorageService } from "../services/storage.server";
import { logger, createLogContext } from "../utils/logger.server";
import { getRequestId } from "../utils/request-context.server";
import { emitPrepEvent } from "../services/prep-events.server";

function getCorsHeaders(shopDomain: string | null): Record<string, string> {
    // Only set CORS origin if we have a valid shop domain
    // Empty origin or "*" would be a security risk
    const headers: Record<string, string> = {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        // CRITICAL: Prevent caching of render responses
        // Without this, browsers/proxies may cache responses and cause stale data
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
    };

    if (shopDomain) {
        headers["Access-Control-Allow-Origin"] = `https://${shopDomain}`;
    }

    return headers;
}

export const action = async ({ request }: ActionFunctionArgs) => {
    const requestId = getRequestId(request);
    const logContext = createLogContext("render", requestId, "start", {});

    const { session } = await authenticate.public.appProxy(request);
    const corsHeaders = getCorsHeaders(session?.shop ?? null);

    // Handle preflight
    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!session) {
        logger.warn(
            { ...logContext, stage: "auth" },
            `App proxy auth failed: no session. URL: ${request.url}`
        );
        return json({ status: "forbidden" }, { status: 403, headers: corsHeaders });
    }

    const body = await request.json();
    const { product_id, variant_id, room_session_id, placement, config } = body;

    // Validate placement data - accept either box_px (new) or x/y/scale (legacy)
    let placementParams: { x: number; y: number; scale: number } | { box_px: { center_x_px: number; center_y_px: number; width_px: number } } | null = null;

    if (placement?.box_px) {
        // New format: box_px in canonical pixels
        const { center_x_px, center_y_px, width_px } = placement.box_px;
        if (!Number.isFinite(center_x_px) || !Number.isFinite(center_y_px) || !Number.isFinite(width_px)) {
            logger.error(
                { ...logContext, stage: "validation" },
                `Invalid box_px placement data: ${JSON.stringify(placement.box_px)}`
            );
            return json(
                { error: "invalid_placement", message: "Placement box_px center_x_px, center_y_px, and width_px are required" },
                { status: 400, headers: corsHeaders }
            );
        }
        placementParams = { box_px: { center_x_px, center_y_px, width_px } };
    } else if (placement && Number.isFinite(placement.x) && Number.isFinite(placement.y)) {
        // Legacy format: normalized x/y/scale
        placementParams = {
            x: placement.x,
            y: placement.y,
            scale: placement.scale || 1.0,
        };
    } else {
        logger.error(
            { ...logContext, stage: "validation" },
            `Invalid placement data: ${JSON.stringify(placement)}`
        );
        return json(
            { error: "invalid_placement", message: "Placement must include either box_px (center_x_px, center_y_px, width_px) or x, y, scale" },
            { status: 400, headers: corsHeaders }
        );
    }

    // Validate room_session_id
    if (!room_session_id) {
        return json(
            { error: "missing_session", message: "room_session_id is required" },
            { status: 400, headers: corsHeaders }
        );
    }

    // Rate limiting check
    if (!checkRateLimit(room_session_id || 'anonymous')) {
        return json(
            { error: "rate_limit_exceeded", message: "Too many requests. Please wait a moment." },
            { status: 429, headers: corsHeaders }
        );
    }

    const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
    if (!shop) {
        logger.error(
            { ...logContext, stage: "shop-lookup" },
            `Shop not found in database: ${session.shop}`
        );
        return json({ error: "Shop not found" }, { status: 404, headers: corsHeaders });
    }

    // Update log context with shop info
    const shopLogContext = { ...logContext, shopId: shop.id, productId: product_id };

    // Quota Check (before starting render)
    try {
        await checkQuota(shop.id, "render", 1);
    } catch (error) {
        if (error instanceof Response) {
            // Return 429 with proper headers
            const headers = { ...corsHeaders, "Content-Type": "application/json" };
            return new Response(error.body, { status: error.status, headers });
        }
        throw error;
    }

    const job = await prisma.renderJob.create({
        data: {
            shop: { connect: { id: shop.id } },
            productId: product_id,
            variantId: variant_id || null,
            roomSession: room_session_id ? { connect: { id: room_session_id } } : undefined,
            placementX: placement.x,
            placementY: placement.y,
            placementScale: placement.scale || 1.0,
            stylePreset: config?.style_preset || "neutral",
            quality: config?.quality || "standard",
            configJson: JSON.stringify({
                ...(config || {}),
                placement_meta: {
                    ...(config?.placement_meta || {}),
                },
            }),
            status: "queued",
            createdAt: new Date(),
        }
    });

    // Product asset is optional - we can render without background removal
    // Include renderInstructions for custom AI prompts
    // Include Gemini file info for pre-uploaded optimization
    const productAsset = await prisma.productAsset.findFirst({
        where: { shopId: shop.id, productId: product_id },
        select: {
            id: true,
            preparedImageUrl: true,
            preparedImageKey: true,
            sourceImageUrl: true,
            status: true,
            renderInstructions: true,
            geminiFileUri: true,
            geminiFileExpiresAt: true,
        }
    });

    // Verify product is enabled for See It
    if (!productAsset || productAsset.status !== "live") {
        await prisma.renderJob.update({
            where: { id: job.id },
            data: {
                status: "failed",
                errorCode: "PRODUCT_NOT_ENABLED",
                errorMessage: "Product not enabled for See It visualization"
            }
        });

        logger.warn(
            { ...shopLogContext, stage: "product-check" },
            `Product ${product_id} not enabled for See It (status: ${productAsset?.status || 'no asset'})`
        );

        return json({
            job_id: job.id,
            status: "failed",
            error: "product_not_enabled",
            message: "This product is not enabled for See It visualization"
        }, { headers: corsHeaders });
    }

    const roomSession = await prisma.roomSession.findUnique({
        where: { id: room_session_id }
    });

    if (!roomSession) {
        await prisma.renderJob.update({
            where: { id: job.id },
            data: { status: "failed", errorMessage: "Room session not found" }
        });
        return json({ job_id: job.id, status: "failed", error: "room_not_found" }, { headers: corsHeaders });
    }

    // Get product image URL - prefer prepared (bg removed), then fallback to original from Shopify
    // Generate fresh signed URL from key if available to prevent 403 from expired URLs
    let productImageUrl: string | null = null;

    if (productAsset?.preparedImageKey) {
        // Generate fresh signed URL from stored key
        try {
            productImageUrl = await StorageService.getSignedReadUrl(
                productAsset.preparedImageKey,
                60 * 60 * 1000 // 1 hour
            );
        } catch (error) {
            logger.warn(
                { ...shopLogContext, stage: "product-url-fallback" },
                "Failed to generate signed URL from key, falling back to stored URL",
                error
            );
            productImageUrl = productAsset.preparedImageUrl ?? null;
        }
    } else if (productAsset?.preparedImageUrl) {
        productImageUrl = productAsset.preparedImageUrl;
    } else if (productAsset?.sourceImageUrl) {
        productImageUrl = productAsset.sourceImageUrl;
    } else if (config?.product_image_url) {
        // Fallback: use the product image URL sent from the frontend
        productImageUrl = config.product_image_url;
    }

    if (!productImageUrl) {
        await prisma.renderJob.update({
            where: { id: job.id },
            data: { status: "failed", errorMessage: "No product image available" }
        });
        return json({ job_id: job.id, status: "failed", error: "no_product_image" }, { headers: corsHeaders });
    }

    logger.info(
        { ...shopLogContext, stage: "composite-start" },
        `Processing composite: productImageUrl=${productImageUrl.substring(0, 80)}, roomSessionId=${room_session_id}, hasProductAsset=${!!productAsset}`
    );

    try {
        // Generate fresh room image URL from stored key
        // Preference: cleaned > canonical > original (legacy fallback)
        // For new sessions, canonical is required for deterministic sizing
        let roomImageUrl: string;
        let roomImageKey: string | null = null;

        if (roomSession.cleanedRoomImageKey) {
            roomImageKey = roomSession.cleanedRoomImageKey;
            roomImageUrl = await StorageService.getSignedReadUrl(roomImageKey, 60 * 60 * 1000);
        } else if (roomSession.canonicalRoomImageKey) {
            roomImageKey = roomSession.canonicalRoomImageKey;
            roomImageUrl = await StorageService.getSignedReadUrl(roomImageKey, 60 * 60 * 1000);
        } else if (roomSession.originalRoomImageKey) {
            roomImageKey = roomSession.originalRoomImageKey;
            roomImageUrl = await StorageService.getSignedReadUrl(roomImageKey, 60 * 60 * 1000);
        } else if (roomSession.cleanedRoomImageUrl || roomSession.originalRoomImageUrl) {
            // Legacy: use stored URL if no keys available
            roomImageUrl = roomSession.cleanedRoomImageUrl ?? roomSession.originalRoomImageUrl;
            logger.warn(
                { ...shopLogContext, stage: "legacy-room-url" },
                "Using legacy room image URL (no key available) - session may have been created before canonical support"
            );
        } else {
            throw new Error("No room image available");
        }

        // For new sessions (created after canonical support), require canonical for deterministic sizing
        // Check if session was created after canonical support rollout (approximate date)
        const canonicalSupportDate = new Date('2026-02-16');
        if (roomSession.createdAt > canonicalSupportDate && !roomSession.canonicalRoomImageKey && !roomSession.cleanedRoomImageKey) {
            logger.error(
                { ...shopLogContext, stage: "missing-canonical" },
                "New session missing canonical room image - required for deterministic sizing"
            );
            await prisma.renderJob.update({
                where: { id: job.id },
                data: {
                    status: "failed",
                    errorCode: "MISSING_CANONICAL_ROOM",
                    errorMessage: "Canonical room image required for this session"
                }
            });
            return json({
                job_id: job.id,
                status: "failed",
                error: "missing_canonical_room",
                message: "Room image must be processed before rendering"
            }, { headers: corsHeaders });
        }

        // Call Gemini directly - no more Cloud Run!
        // Pass custom product instructions if available
        // Include Gemini file URIs if available for faster renders
        let capturedTelemetry: {
            prompt: string;
            model: string;
            aspectRatio: string;
            useRoomUri: boolean;
            useProductUri: boolean;
            placement: { x: number; y: number; scale: number } | { box_px: { center_x_px: number; center_y_px: number; width_px: number } };
            stylePreset: string;
            placementPrompt?: string;
            canonicalRoomKey?: string | null;
            canonicalRoomWidth?: number | null;
            canonicalRoomHeight?: number | null;
            canonicalRoomRatio?: string | null;
            productResizedWidth?: number;
            productResizedHeight?: number;
        } | null = null;

        // Emit render_job_started event (if we have an asset)
        if (productAsset?.id) {
            emitPrepEvent(
                {
                    assetId: productAsset.id,
                    productId: product_id,
                    shopId: shop.id,
                    eventType: "render_job_started",
                    actorType: "system",
                    payload: {
                        renderJobId: job.id,
                        roomSessionId: room_session_id || undefined,
                        isLiveRender: true,
                    },
                },
                null,
                requestId
            ).catch(() => {
                // Non-critical
            });
        }

        // Convert placement params for compositeScene
        // If box_px provided, convert to normalized coords using canonical room dimensions
        let compositePlacement: { x: number; y: number; scale: number; width_px?: number; canonical_width?: number; canonical_height?: number };

        if (placementParams && 'box_px' in placementParams) {
            // Convert box_px to normalized coords using canonical room dimensions
            const canonicalWidth = roomSession.canonicalRoomWidth || 0;
            const canonicalHeight = roomSession.canonicalRoomHeight || 0;

            if (!canonicalWidth || !canonicalHeight) {
                logger.error(
                    { ...shopLogContext, stage: "validation" },
                    "box_px placement requires canonical room dimensions but they are missing"
                );
                await prisma.renderJob.update({
                    where: { id: job.id },
                    data: {
                        status: "failed",
                        errorCode: "MISSING_CANONICAL_DIMENSIONS",
                        errorMessage: "Canonical room dimensions required for box_px placement"
                    }
                });
                return json({
                    job_id: job.id,
                    status: "failed",
                    error: "missing_canonical_dimensions",
                    message: "Canonical room dimensions are required for this placement format"
                }, { headers: corsHeaders });
            }

            const { center_x_px, center_y_px, width_px } = placementParams.box_px;
            
            // Convert pixel coords to normalized (0-1)
            const x_norm = center_x_px / canonicalWidth;
            const y_norm = center_y_px / canonicalHeight;

            compositePlacement = {
                x: Math.max(0, Math.min(1, x_norm)),
                y: Math.max(0, Math.min(1, y_norm)),
                scale: 1.0, // Will be overridden by width_px in compositeScene
                width_px: width_px,
                canonical_width: canonicalWidth,
                canonical_height: canonicalHeight,
                canonicalRoomKey: roomSession.canonicalRoomImageKey || null
            };

            logger.info(
                { ...shopLogContext, stage: "placement-conversion" },
                `Converted box_px to normalized: (${center_x_px}, ${center_y_px}, ${width_px}px) -> (${compositePlacement.x.toFixed(3)}, ${compositePlacement.y.toFixed(3)}) in ${canonicalWidth}x${canonicalHeight}`
            );
        } else if (placementParams && 'x' in placementParams) {
            // Legacy format: use normalized coords directly
            compositePlacement = placementParams;
        } else {
            throw new Error("Invalid placement params");
        }

        const compositeOptions: CompositeOptions = {
            roomGeminiUri: roomSession.geminiFileUri,
            roomGeminiExpiresAt: roomSession.geminiFileExpiresAt,
            productGeminiUri: productAsset?.geminiFileUri ?? null,
            productGeminiExpiresAt: productAsset?.geminiFileExpiresAt ?? null,
            onPromptBuilt: (telemetry) => {
                capturedTelemetry = telemetry;
            },
        };

        const result = await compositeScene(
            productImageUrl,
            roomImageUrl,
            compositePlacement,
            config?.style_preset || "neutral",
            requestId,
            productAsset?.renderInstructions || undefined,
            compositeOptions
        );

        // Store both URL and key - key enables URL regeneration when signed URL expires
        await prisma.renderJob.update({
            where: { id: job.id },
            data: {
                status: "completed",
                imageUrl: result.imageUrl,
                imageKey: result.imageKey,
                completedAt: new Date()
            }
        });

        // Increment quota only after successful render
        await incrementQuota(shop.id, "render", 1);

        // Emit render_prompt_built event (if we captured telemetry)
        if (productAsset?.id && capturedTelemetry) {
            // Simple hash function for prompt grouping (non-cryptographic)
            const promptHash = capturedTelemetry.prompt.split('').reduce((acc, char) => {
                const hash = ((acc << 5) - acc) + char.charCodeAt(0);
                return hash & hash;
            }, 0).toString(36);

            emitPrepEvent(
                {
                    assetId: productAsset.id,
                    productId: product_id,
                    shopId: shop.id,
                    eventType: "render_prompt_built",
                    actorType: "system",
                    payload: {
                        renderJobId: job.id,
                        roomSessionId: room_session_id || undefined,
                        isLiveRender: true,
                        provider: "gemini",
                        model: capturedTelemetry.model,
                        aspectRatio: capturedTelemetry.aspectRatio,
                        prompt: capturedTelemetry.prompt,
                        promptHash,
                        placement: capturedTelemetry.placement,
                        stylePreset: capturedTelemetry.stylePreset,
                        placementPrompt: capturedTelemetry.placementPrompt || undefined,
                        useRoomUri: capturedTelemetry.useRoomUri,
                        useProductUri: capturedTelemetry.useProductUri,
                        // Canonical room telemetry
                        canonicalRoomKey: capturedTelemetry.canonicalRoomKey || undefined,
                        canonicalRoomWidth: capturedTelemetry.canonicalRoomWidth || undefined,
                        canonicalRoomHeight: capturedTelemetry.canonicalRoomHeight || undefined,
                        canonicalRoomRatio: capturedTelemetry.canonicalRoomRatio || undefined,
                        // Product resize telemetry
                        productResizedWidth: capturedTelemetry.productResizedWidth || undefined,
                        productResizedHeight: capturedTelemetry.productResizedHeight || undefined,
                    },
                },
                null,
                requestId
            ).catch(() => {
                // Non-critical
            });
        }

        // Emit render_job_completed event
        if (productAsset?.id) {
            emitPrepEvent(
                {
                    assetId: productAsset.id,
                    productId: product_id,
                    shopId: shop.id,
                    eventType: "render_job_completed",
                    actorType: "system",
                    payload: {
                        renderJobId: job.id,
                        roomSessionId: room_session_id || undefined,
                        isLiveRender: true,
                        outputImageKey: result.imageKey,
                        outputImageUrl: result.imageUrl,
                        promptHash: capturedTelemetry ? (capturedTelemetry.prompt.split('').reduce((acc, char) => {
                            const hash = ((acc << 5) - acc) + char.charCodeAt(0);
                            return hash & hash;
                        }, 0).toString(36)) : undefined,
                    },
                },
                null,
                requestId
            ).catch(() => {
                // Non-critical
            });
        }

        logger.info(
            { ...shopLogContext, stage: "complete" },
            `Render completed successfully: jobId=${job.id}`
        );

        // Return job_id with status so client can skip polling if already complete
        return json({
            job_id: job.id,
            status: "completed",
            image_url: result.imageUrl,
            imageUrl: result.imageUrl
        }, { headers: corsHeaders });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(
            { ...shopLogContext, stage: "composite-error" },
            "Gemini composite failed",
            error
        );
        await prisma.renderJob.update({
            where: { id: job.id },
            data: {
                status: "failed",
                errorCode: "GEMINI_ERROR",
                errorMessage: errorMessage
            }
        });

        // Emit render_job_failed event
        if (productAsset?.id) {
            emitPrepEvent(
                {
                    assetId: productAsset.id,
                    productId: product_id,
                    shopId: shop.id,
                    eventType: "render_job_failed",
                    actorType: "system",
                    payload: {
                        renderJobId: job.id,
                        roomSessionId: room_session_id || undefined,
                        isLiveRender: true,
                        errorMessage: errorMessage.substring(0, 500),
                        errorCode: "GEMINI_ERROR",
                    },
                },
                null,
                requestId
            ).catch(() => {
                // Non-critical
            });
        }

        // Return error message to frontend for debugging
        return json({
            job_id: job.id,
            status: "failed",
            error: errorMessage,
            error_code: "GEMINI_ERROR"
        }, { headers: corsHeaders });
    }

    // If we get here without returning, something unexpected happened
    return json({ job_id: job.id, status: "failed", error: "Unknown failure" }, { headers: corsHeaders });
};
