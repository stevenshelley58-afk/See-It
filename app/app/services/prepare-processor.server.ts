import prisma from "../db.server";
import { prepareProduct, compositeScene, type PrepareProductResult } from "./gemini.server";
import { logger, createLogContext, generateRequestId } from "../utils/logger.server";
import { StorageService } from "./storage.server";
import { incrementQuota } from "../quota.server";
import { emitPrepEvent } from "./prep-events.server";
import { extractStructuredFields, generateProductDescription } from "./description-writer.server";
import { GoogleGenAI } from "@google/genai";
import { Prisma } from "@prisma/client";
import { getSeeItNowAllowedShops, isSeeItNowAllowedShop } from "~/utils/see-it-now-allowlist.server";

// NEW: See It Now 2-LLM pipeline imports
import {
    extractProductFacts,
    resolveProductFacts,
    buildPlacementSet,
} from "./see-it-now/index";

let processorInterval: NodeJS.Timeout | null = null;
let isProcessing = false;

// Configuration for retry logic
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 5000; // 5 seconds base delay

// Legacy placement config generation is opt-in (default OFF).
// This path uses ad-hoc prompt+parsing and should not run in production unless explicitly enabled.
const ENABLE_LEGACY_PLACEMENT_CONFIG =
    process.env.SEE_IT_ENABLE_LEGACY_PLACEMENT_CONFIG === "true";

/**
 * Calculate exponential backoff delay
 * Delay = baseDelay * 2^retryCount (5s, 10s, 20s for retries 0, 1, 2)
 */
function getRetryDelay(retryCount: number): number {
    return RETRY_BASE_DELAY_MS * Math.pow(2, retryCount);
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable (transient errors that may succeed on retry)
 */
function isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    const message = error.message.toLowerCase();

    // Retryable errors: network issues, rate limits, temporary failures
    const retryablePatterns = [
        'network',
        'timeout',
        'econnreset',
        'econnrefused',
        'etimedout',
        'rate limit',
        'too many requests',
        '429',
        '503',
        '502',
        '504',
        'temporarily unavailable',
        'service unavailable',
        'internal server error',
        'aborted',
    ];

    return retryablePatterns.some(pattern => message.includes(pattern));
}

// Legacy PlacementConfig interface removed - renderInstructions, sceneRole, etc. no longer in schema

interface RenderPromptTelemetry {
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
}

// Legacy generatePlacementConfig function removed - placement prompts now come from
// canonical pipeline: extractedFacts -> merchantOverrides -> resolvedFacts -> placementSet

type ShopifyProductForPrompt = {
    title?: string | null;
    description?: string | null;
    descriptionHtml?: string | null;
    productType?: string | null;
    vendor?: string | null;
    tags?: string[] | null;
    images?: { edges?: Array<{ node?: { url?: string } }> } | null;
    metafields?: { edges?: Array<{ node?: { namespace?: string; key?: string; value?: string; type?: string } }> } | null;
};

async function fetchShopifyProductForPrompt(
    shopDomain: string,
    accessToken: string,
    productId: string,
    requestId: string
): Promise<ShopifyProductForPrompt | null> {
    // Guard: missing/placeholder token
    if (!accessToken || accessToken === "pending") return null;

    // Shopify Admin API GraphQL endpoint (Jan 2025)
    const endpoint = `https://${shopDomain}/admin/api/2025-01/graphql.json`;

    const query = `#graphql
        query GetProductForPrompt($id: ID!) {
            product(id: $id) {
                title
                description
                descriptionHtml
                productType
                vendor
                tags
                images(first: 3) {
                  edges {
                    node {
                      url
                    }
                  }
                }
                metafields(first: 20) {
                    edges {
                        node {
                            namespace
                            key
                            value
                            type
                        }
                    }
                }
            }
        }
    `;

    try {
        const res = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": accessToken,
            },
            body: JSON.stringify({
                query,
                variables: { id: `gid://shopify/Product/${productId}` },
            }),
        });

        if (!res.ok) {
            logger.warn(
                createLogContext("prepare", requestId, "shopify-product-fetch", {
                    status: res.status,
                    statusText: res.statusText,
                }),
                `Failed to fetch product from Shopify Admin API (HTTP ${res.status})`
            );
            return null;
        }

        const json = await res.json().catch(() => null);
        const product = json?.data?.product as ShopifyProductForPrompt | undefined;
        return product || null;
    } catch (err) {
        logger.warn(
            createLogContext("prepare", requestId, "shopify-product-fetch", {
                error: err instanceof Error ? err.message : String(err),
            }),
            "Failed to fetch product from Shopify Admin API (network/parsing)"
        );
        return null;
    }
}

async function processPendingAssets(batchRequestId: string): Promise<boolean> {
    try {
        // Fetch pending assets that haven't exceeded retry limit
        const pendingAssets = await prisma.productAsset.findMany({
            where: {
                status: "preparing",
                retryCount: { lt: MAX_RETRY_ATTEMPTS }
            },
            take: 5,
            orderBy: { createdAt: "asc" },
            select: {
                id: true,
                productId: true,
                retryCount: true,
                shopId: true,
                sourceImageUrl: true,
            }
        });

        if (pendingAssets.length === 0) {
            // Log periodically that processor is running but idle (helpful for debugging)
            logger.debug(
                createLogContext("prepare", batchRequestId, "batch-idle", {}),
                "No pending assets to process"
            );
            return false;
        }

        logger.info(
            createLogContext("prepare", batchRequestId, "batch-start-assets", {
                count: pendingAssets.length,
                assetIds: pendingAssets.map((asset: { id: string }) => asset.id).join(',')
            }),
            `Processing ${pendingAssets.length} pending assets: [${pendingAssets.map((asset: { productId: string; retryCount: number | null }) => `${asset.productId}(retry:${asset.retryCount})`).join(', ')}]`
        );

        for (const asset of pendingAssets) {
            const itemRequestId = generateRequestId();
            const currentRetryCount = asset.retryCount ?? 0;

            try {
                // Lock the asset for processing
                const updated = await prisma.productAsset.updateMany({
                    where: { id: asset.id, status: "preparing" },
                    data: { status: "processing", updatedAt: new Date() }
                });

                if (updated.count === 0) continue; // Lost race

                logger.info(
                    createLogContext("prepare", itemRequestId, "asset-start", {
                        assetId: asset.id,
                        productId: asset.productId,
                        shopId: asset.shopId,
                        sourceUrl: asset.sourceImageUrl?.substring(0, 60),
                        retryCount: currentRetryCount
                    }),
                    `Starting asset ${asset.productId} (attempt ${currentRetryCount + 1}/${MAX_RETRY_ATTEMPTS})`
                );

                // Attempt processing with inline retry for transient errors
                let lastError: unknown = null;
                let success = false;
                let prepareResult: PrepareProductResult | null = null;

                for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS && !success; attempt++) {
                    try {
                        if (attempt > 0) {
                            const delay = getRetryDelay(attempt - 1);
                            logger.info(
                                createLogContext("prepare", itemRequestId, "asset-retry", {
                                    assetId: asset.id,
                                    attempt: attempt + 1,
                                    delay
                                }),
                                `Retry attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS} after ${delay}ms delay`
                            );
                            await sleep(delay);
                        }

                        prepareResult = await prepareProduct(
                            asset.sourceImageUrl,
                            asset.shopId,
                            asset.productId,
                            asset.id,
                            itemRequestId
                        );
                        success = true;

                        // Emit auto_cutout_created event
                        await emitPrepEvent(
                            {
                                assetId: asset.id,
                                productId: asset.productId,
                                shopId: asset.shopId,
                                eventType: "auto_cutout_created",
                                actorType: "system",
                                payload: {
                                    source: "auto",
                                    preparedImageKey: extractGcsKeyFromUrl(prepareResult.url) || undefined,
                                    geminiFileUri: prepareResult.geminiFileUri || undefined,
                                },
                            },
                            null,
                            itemRequestId
                        ).catch((err) => {
                            // Non-critical - log but don't fail
                            logger.debug(
                                createLogContext("prepare", itemRequestId, "event-emit-failed", {}),
                                `Failed to emit auto_cutout_created: ${err instanceof Error ? err.message : String(err)}`
                            );
                        });
                    } catch (error) {
                        lastError = error;
                        const errorMessage = error instanceof Error ? error.message : "Unknown error";

                        // Emit auto_cutout_failed on first attempt failure
                        if (attempt === 0) {
                            await emitPrepEvent(
                                {
                                    assetId: asset.id,
                                    productId: asset.productId,
                                    shopId: asset.shopId,
                                    eventType: "auto_cutout_failed",
                                    actorType: "system",
                                    payload: {
                                        source: "auto",
                                        error: errorMessage,
                                        retryable: isRetryableError(error),
                                    },
                                },
                                null,
                                itemRequestId
                            ).catch(() => {
                                // Non-critical
                            });
                        }

                        // Only retry for transient errors
                        if (!isRetryableError(error)) {
                            logger.warn(
                                createLogContext("prepare", itemRequestId, "asset-non-retryable", {
                                    assetId: asset.id,
                                    productId: asset.productId,
                                    attempt: attempt + 1,
                                    errorType: error?.constructor?.name || 'Unknown'
                                }),
                                `Non-retryable error for product ${asset.productId}: ${errorMessage}`
                            );
                            break; // Exit retry loop for permanent errors
                        }

                        logger.warn(
                            createLogContext("prepare", itemRequestId, "asset-attempt-failed", {
                                assetId: asset.id,
                                productId: asset.productId,
                                attempt: attempt + 1
                            }),
                            `Attempt ${attempt + 1} failed for product ${asset.productId}: ${errorMessage}`
                        );
                    }
                }

                if (success && prepareResult) {
                    // ========================================================================
                    // See It Now 2-LLM Pipeline
                    // ========================================================================

                    // Fetch shop + product context for extraction
                    const shopRecord = await prisma.shop.findUnique({
                        where: { id: asset.shopId },
                        select: { shopDomain: true, accessToken: true, settingsJson: true },
                    });

                    const shopifyProduct = shopRecord
                        ? await fetchShopifyProductForPrompt(
                            shopRecord.shopDomain,
                            shopRecord.accessToken,
                            asset.productId,
                            itemRequestId
                        )
                        : null;

                    const metafieldText = Array.isArray(shopifyProduct?.metafields?.edges)
                        ? shopifyProduct!.metafields!.edges!
                            .map((e) => e?.node?.value)
                            .filter(Boolean)
                            .join(" ")
                        : "";

                    const combinedDescription = `${shopifyProduct?.description || ""}\n${shopifyProduct?.descriptionHtml || ""}\n${metafieldText}`.trim();

                    const metafieldsRecord: Record<string, string> = {};
                    if (Array.isArray(shopifyProduct?.metafields?.edges)) {
                        for (const edge of shopifyProduct!.metafields!.edges!) {
                            const node = edge?.node;
                            if (node?.namespace && node?.key && node?.value) {
                                metafieldsRecord[`${node.namespace}.${node.key}`] = node.value;
                            }
                        }
                    }

                    // Collect up to 3 unique images (starting with sourceImageUrl)
                    const uniqueImages = new Set<string>();
                    if (asset.sourceImageUrl) uniqueImages.add(asset.sourceImageUrl);

                    if (Array.isArray(shopifyProduct?.images?.edges)) {
                        for (const edge of shopifyProduct!.images!.edges!) {
                            const url = edge?.node?.url;
                            if (url) uniqueImages.add(url);
                            if (uniqueImages.size >= 3) break;
                        }
                    }

                    // Step 1: Extract product facts (LLM #1) - FAIL HARD
                    const extractionInput = {
                        title: shopifyProduct?.title || asset.productTitle || `Product ${asset.productId}`,
                        description: combinedDescription || "",
                        productType: shopifyProduct?.productType || asset.productType || null,
                        vendor: shopifyProduct?.vendor || null,
                        tags: (shopifyProduct?.tags || []) as string[],
                        metafields: metafieldsRecord,
                        imageUrls: Array.from(uniqueImages),
                    };

                    if (!extractionInput.title || extractionInput.imageUrls.length === 0) {
                        throw new Error("Missing product title or images for extraction");
                    }

                    const extractedFacts = await extractProductFacts({
                        input: extractionInput,
                        productAssetId: asset.id,
                        shopId: asset.shopId,
                        traceId: itemRequestId,
                    });

                    logger.info(
                        createLogContext("prepare", itemRequestId, "extraction-complete", {
                            productKind: extractedFacts.identity?.product_kind,
                            scaleClass: extractedFacts.relative_scale?.class,
                        }),
                        `Extraction complete for ${asset.productId}`
                    );

                    // Step 2: Resolve facts (merge with any existing merchant overrides)
                    const merchantOverrides = (asset.merchantOverrides as any) || null;
                    const resolvedFacts = resolveProductFacts(extractedFacts, merchantOverrides);

                    // Step 3: Build placement set (LLM #2) - FAIL HARD
                    const placementSet = await buildPlacementSet({
                        resolvedFacts,
                        productAssetId: asset.id,
                        shopId: asset.shopId,
                        traceId: itemRequestId,
                    });

                    if (!placementSet?.variants || placementSet.variants.length !== 8) {
                        throw new Error(
                            `Invalid placement set: expected 8 variants, got ${placementSet?.variants?.length ?? 0}`
                        );
                    }

                    logger.info(
                        createLogContext("prepare", itemRequestId, "placement-set-complete", {
                            variantCount: placementSet.variants.length,
                        }),
                        `Placement set built for ${asset.productId}`
                    );

                    // Extract GCS key from the signed URL for on-demand URL generation
                    const preparedImageKey = extractGcsKeyFromUrl(prepareResult.url);

                    // Prepare update data with canonical fields only
                    const updateData: any = {
                        status: "ready",
                        enabled: false, // Merchant must enable after reviewing
                        preparedImageUrl: prepareResult.url,
                        preparedImageKey: preparedImageKey,
                        geminiFileUri: prepareResult.geminiFileUri,
                        geminiFileExpiresAt: prepareResult.geminiFileExpiresAt,
                        retryCount: 0, // Reset retry count on success
                        errorMessage: null,
                        updatedAt: new Date(),

                        // See It Now 2-LLM Pipeline fields (canonical) - REQUIRED
                        extractedFacts,
                        resolvedFacts,
                        placementSet,
                        extractedAt: new Date(),
                    };

                    await prisma.productAsset.update({
                        where: { id: asset.id },
                        data: updateData
                    });

                    // Emit prep_confirmed event (system)
                    await emitPrepEvent(
                        {
                            assetId: asset.id,
                            productId: asset.productId,
                            shopId: asset.shopId,
                            eventType: "prep_confirmed",
                            actorType: "system",
                            payload: {
                                source: "auto",
                                status: "ready",
                            },
                        },
                        null,
                        itemRequestId
                    ).catch(() => {
                        // Non-critical
                    });

                    logger.info(
                        createLogContext("prepare", itemRequestId, "asset-complete", {
                            assetId: asset.id,
                            productId: asset.productId,
                            gcsKey: preparedImageKey,
                            geminiUri: prepareResult.geminiFileUri ?? '(not uploaded)'
                        }),
                        `Product ${asset.productId} prepared successfully -> ${preparedImageKey}${prepareResult.geminiFileUri ? ' + Gemini pre-upload' : ''}`
                    );
                } else {
                    // All retries exhausted or permanent error
                    const newRetryCount = currentRetryCount + 1;
                    const errorMessage = lastError instanceof Error ? lastError.message : "Unknown error";
                    const errorStack = lastError instanceof Error ? lastError.stack?.split('\n').slice(0, 3).join(' | ') : '';
                    const isFinalFailure = newRetryCount >= MAX_RETRY_ATTEMPTS || !isRetryableError(lastError);

                    logger.error(
                        createLogContext("prepare", itemRequestId, "asset-error", {
                            assetId: asset.id,
                            productId: asset.productId,
                            retryCount: newRetryCount,
                            isFinal: isFinalFailure,
                            errorType: lastError?.constructor?.name || 'Unknown',
                            stackPreview: errorStack
                        }),
                        `FAILED product ${asset.productId}${isFinalFailure ? " (FINAL - giving up)" : " (will retry)"}: ${errorMessage}`,
                        lastError
                    );

                    await prisma.productAsset.update({
                        where: { id: asset.id },
                        data: {
                            status: isFinalFailure ? "failed" : "preparing",
                            errorMessage: errorMessage.substring(0, 500),
                            retryCount: newRetryCount,
                            updatedAt: new Date()
                        }
                    });
                }
            } catch (error) {
                // Outer error handler for unexpected errors (DB errors, etc.)
                const errorMessage = error instanceof Error ? error.message : "Unknown error";
                const errorStack = error instanceof Error ? error.stack?.split('\n').slice(0, 5).join(' | ') : '';

                logger.error(
                    createLogContext("prepare", itemRequestId, "asset-critical-error", {
                        assetId: asset.id,
                        productId: asset.productId,
                        errorType: error?.constructor?.name || 'Unknown',
                        stackPreview: errorStack
                    }),
                    `CRITICAL ERROR processing product ${asset.productId}: ${errorMessage}`,
                    error
                );

                // Mark as failed without retry for critical errors
                try {
                    await prisma.productAsset.update({
                        where: { id: asset.id },
                        data: {
                            status: "failed",
                            errorMessage: `Critical: ${errorMessage.substring(0, 450)}`,
                            updatedAt: new Date()
                        }
                    });
                } catch (updateError) {
                    logger.error(
                        createLogContext("prepare", itemRequestId, "asset-update-failed", {
                            assetId: asset.id,
                            productId: asset.productId
                        }),
                        `Failed to update asset status after critical error: ${updateError instanceof Error ? updateError.message : 'Unknown'}`,
                        updateError
                    );
                }
            }
        }

        return true;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(
            createLogContext("prepare", batchRequestId, "asset-loop-error", {
                errorType: error?.constructor?.name || 'Unknown'
            }),
            `Asset processing loop crashed: ${errorMessage}`,
            error
        );
        return false;
    }
}

/**
 * Extract the GCS key from a signed URL
 * Example: https://storage.googleapis.com/bucket/products/shop/product/asset_prepared.png?X-Goog-...
 * Returns: products/shop/product/asset_prepared.png
 */
function extractGcsKeyFromUrl(signedUrl: string): string | null {
    try {
        const url = new URL(signedUrl);
        // GCS signed URLs have the format: /bucket-name/key
        // Remove the leading slash and bucket name
        const pathParts = url.pathname.split('/');
        if (pathParts.length >= 3) {
            // Skip empty string and bucket name, join the rest
            return pathParts.slice(2).join('/');
        }
        return null;
    } catch {
        return null;
    }
}

async function processPendingRenderJobs(batchRequestId: string): Promise<boolean> {
    try {
        // Fetch queued jobs that haven't exceeded retry limit
        const pendingJobs = await prisma.renderJob.findMany({
            where: {
                status: "queued",
                retryCount: { lt: MAX_RETRY_ATTEMPTS }
            },
            take: 5,
            orderBy: { createdAt: "asc" },
            include: { roomSession: true }
        });

        if (pendingJobs.length === 0) {
            return false;
        }

        if (pendingJobs.length > 0) {
            logger.info(
                createLogContext("prepare", batchRequestId, "batch-start-jobs", {}),
                `Processing batch of ${pendingJobs.length} render jobs`
            );

            for (const job of pendingJobs) {
                const itemRequestId = generateRequestId();
                const currentRetryCount = job.retryCount ?? 0;

                try {
                    // Lock
                    const updated = await prisma.renderJob.updateMany({
                        where: { id: job.id, status: "queued" },
                        data: { status: "processing" }
                    });

                    if (updated.count === 0) continue;

                    logger.info(
                        createLogContext("prepare", itemRequestId, "job-start", {
                            jobId: job.id,
                            retryCount: currentRetryCount
                        }),
                        `Starting render job (attempt ${currentRetryCount + 1}/${MAX_RETRY_ATTEMPTS})`
                    );

                    // Fetch shop for settings
                    const shop = await prisma.shop.findUnique({
                        where: { id: job.shopId },
                        select: { settingsJson: true }
                    });
                    const settings = shop?.settingsJson ? JSON.parse(shop.settingsJson) : {};
                    const generalPrompt = settings.seeItPrompt || '';
                    const coordinateInstructions = settings.coordinateInstructions || '';

                    // 1. Get Product Image URL (generate fresh URL if key is available)
                    const productAsset = await prisma.productAsset.findFirst({
                        where: { shopId: job.shopId, productId: job.productId },
                        select: {
                            id: true,
                            preparedImageKey: true,
                            preparedImageUrl: true,
                            sourceImageUrl: true,
                            geminiFileUri: true,
                            geminiFileExpiresAt: true,
                            placementSet: true,
                        }
                    });

                    // Emit render_job_started event
                    if (productAsset?.id) {
                        emitPrepEvent(
                            {
                                assetId: productAsset.id,
                                productId: job.productId,
                                shopId: job.shopId,
                                eventType: "render_job_started",
                                actorType: "system",
                                payload: {
                                    renderJobId: job.id,
                                    roomSessionId: job.roomSessionId || undefined,
                                    attempt: currentRetryCount + 1,
                                    maxAttempts: MAX_RETRY_ATTEMPTS,
                                },
                            },
                            null,
                            itemRequestId
                        ).catch(() => {
                            // Non-critical
                        });
                    }

                    let productImageUrl: string | null = null;
                    let config: Record<string, unknown> = {};
                    try {
                        config = JSON.parse(job.configJson || '{}');
                    } catch {
                        // Invalid JSON in configJson - use empty config
                    }

                    if (productAsset?.preparedImageKey) {
                        // Generate fresh URL from stored key
                        productImageUrl = await StorageService.getSignedReadUrl(productAsset.preparedImageKey, 60 * 60 * 1000);
                    } else if (productAsset?.preparedImageUrl) {
                        productImageUrl = productAsset.preparedImageUrl;
                    } else if (productAsset?.sourceImageUrl) {
                        productImageUrl = productAsset.sourceImageUrl;
                    } else if (typeof config?.product_image_url === "string") {
                        productImageUrl = config.product_image_url;
                    }

                    if (!productImageUrl) {
                        await prisma.renderJob.update({
                            where: { id: job.id },
                            data: {
                                status: "failed",
                                errorMessage: "No product image available",
                                errorCode: "NO_PRODUCT_IMAGE"
                            }
                        });
                        continue;
                    }

                    // 2. Get Room Image URL
                    const roomSession = job.roomSession;
                    if (!roomSession) {
                        await prisma.renderJob.update({
                            where: { id: job.id },
                            data: {
                                status: "failed",
                                errorMessage: "Room session not found",
                                errorCode: "NO_ROOM_SESSION"
                            }
                        });
                        continue;
                    }

                    let roomImageUrl: string;
                    if (roomSession.cleanedRoomImageKey) {
                        roomImageUrl = await StorageService.getSignedReadUrl(roomSession.cleanedRoomImageKey, 60 * 60 * 1000);
                    } else if (roomSession.originalRoomImageKey) {
                        roomImageUrl = await StorageService.getSignedReadUrl(roomSession.originalRoomImageKey, 60 * 60 * 1000);
                    } else if (roomSession.cleanedRoomImageUrl || roomSession.originalRoomImageUrl) {
                        roomImageUrl = roomSession.cleanedRoomImageUrl ?? roomSession.originalRoomImageUrl;
                    } else {
                        throw new Error("No room image available");
                    }

                    // 3. Render with retry logic
                    let lastError: unknown = null;
                    let success = false;
                    let compositeResult: { imageUrl: string; imageKey: string } | null = null;
                    let capturedTelemetry: RenderPromptTelemetry | null = null;

                    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS && !success; attempt++) {
                        try {
                            if (attempt > 0) {
                                const delay = getRetryDelay(attempt - 1);
                                logger.info(
                                    createLogContext("prepare", itemRequestId, "job-retry", {
                                        jobId: job.id,
                                        attempt: attempt + 1,
                                        delay
                                    }),
                                    `Retry attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS} after ${delay}ms delay`
                                );
                                await sleep(delay);
                            }

                            const placement = {
                                x: job.placementX,
                                y: job.placementY,
                                scale: job.placementScale,
                            };

                            // Reset captured telemetry for this attempt
                            capturedTelemetry = null;

                            // Build placement prompt from placementSet if available
                            let placementPrompt: string | undefined = undefined;
                            if (productAsset?.placementSet) {
                                try {
                                    const placementSet = productAsset.placementSet as any;
                                    if (placementSet?.productDescription) {
                                        // Get variant instruction (default to V01 if no variantId in job)
                                        const variantId = (job as any).variantId || 'V01';
                                        const variant = placementSet.variants?.find((v: any) => v.id === variantId) || placementSet.variants?.[0];
                                        
                                        if (variant?.placementInstruction) {
                                            // Combine product description with variant-specific instruction
                                            placementPrompt = `${placementSet.productDescription}\n\n${variant.placementInstruction}`;
                                        } else {
                                            // Fallback to just product description
                                            placementPrompt = placementSet.productDescription;
                                        }
                                    }
                                } catch (e) {
                                    logger.warn(
                                        createLogContext("prepare", itemRequestId, "placement-prompt-error", {}),
                                        `Failed to parse placementSet: ${e instanceof Error ? e.message : 'Unknown error'}`
                                    );
                                }
                            }

                            // compositeScene now returns { imageUrl, imageKey }
                            // Placement prompts come from placementSet generated during batch prep
                            compositeResult = await compositeScene(
                                productImageUrl,
                                roomImageUrl,
                                placement,
                                job.stylePreset ?? "neutral",
                                itemRequestId,
                                placementPrompt,
                                {
                                    roomGeminiUri: roomSession.geminiFileUri,
                                    roomGeminiExpiresAt: roomSession.geminiFileExpiresAt,
                                    productGeminiUri: productAsset?.geminiFileUri ?? null,
                                    productGeminiExpiresAt: productAsset?.geminiFileExpiresAt ?? null,
                                    onPromptBuilt: (telemetry) => {
                                        capturedTelemetry = telemetry;
                                    },
                                },
                                generalPrompt,
                                coordinateInstructions
                            );
                            success = true;
                        } catch (error) {
                            lastError = error;
                            const errorMessage = error instanceof Error ? error.message : "Unknown error";

                            if (!isRetryableError(error)) {
                                logger.warn(
                                    createLogContext("prepare", itemRequestId, "job-non-retryable", {
                                        jobId: job.id,
                                        attempt: attempt + 1
                                    }),
                                    `Non-retryable error: ${errorMessage}`
                                );
                                break;
                            }

                            logger.warn(
                                createLogContext("prepare", itemRequestId, "job-attempt-failed", {
                                    jobId: job.id,
                                    attempt: attempt + 1
                                }),
                                `Attempt ${attempt + 1} failed with retryable error: ${errorMessage}`
                            );
                        }
                    }

                    if (success && compositeResult) {
                        // compositeScene now returns both imageUrl and imageKey directly
                        await prisma.renderJob.update({
                            where: { id: job.id },
                            data: {
                                status: "completed",
                                imageUrl: compositeResult.imageUrl,
                                imageKey: compositeResult.imageKey,
                                retryCount: 0,
                                completedAt: new Date()
                            }
                        });

                        await incrementQuota(job.shopId, "render", 1);

                        const telemetry = capturedTelemetry as RenderPromptTelemetry | null;
                        const promptHash = telemetry?.prompt
                            ? telemetry.prompt.split('').reduce((acc: number, char: string) => {
                                const hash = ((acc << 5) - acc) + char.charCodeAt(0);
                                return hash & hash;
                            }, 0).toString(36)
                            : undefined;

                        // Emit render_prompt_built event (if we captured telemetry)
                        if (productAsset?.id && telemetry) {
                            emitPrepEvent(
                                {
                                    assetId: productAsset.id,
                                    productId: job.productId,
                                    shopId: job.shopId,
                                    eventType: "render_prompt_built",
                                    actorType: "system",
                                    payload: {
                                        renderJobId: job.id,
                                        roomSessionId: job.roomSessionId || undefined,
                                        provider: "gemini",
                                        model: telemetry.model,
                                        aspectRatio: telemetry.aspectRatio,
                                        prompt: telemetry.prompt,
                                        promptHash,
                                        placement: telemetry.placement,
                                        stylePreset: telemetry.stylePreset,
                                        placementPrompt: telemetry.placementPrompt || undefined,
                                        useRoomUri: telemetry.useRoomUri,
                                        useProductUri: telemetry.useProductUri,
                                    },
                                },
                                null,
                                itemRequestId
                            ).catch(() => {
                                // Non-critical
                            });
                        }

                        // Emit render_job_completed event
                        if (productAsset?.id) {
                            emitPrepEvent(
                                {
                                    assetId: productAsset.id,
                                    productId: job.productId,
                                    shopId: job.shopId,
                                    eventType: "render_job_completed",
                                    actorType: "system",
                                    payload: {
                                        renderJobId: job.id,
                                        roomSessionId: job.roomSessionId || undefined,
                                        outputImageKey: compositeResult.imageKey,
                                        outputImageUrl: compositeResult.imageUrl,
                                        promptHash,
                                    },
                                },
                                null,
                                itemRequestId
                            ).catch(() => {
                                // Non-critical
                            });
                        }

                        logger.info(
                            createLogContext("prepare", itemRequestId, "job-complete", { jobId: job.id }),
                            "Render job completed successfully"
                        );
                    } else {
                        // All retries exhausted or permanent error
                        const newRetryCount = currentRetryCount + 1;
                        const errorMessage = lastError instanceof Error ? lastError.message : "Unknown error";
                        const isFinalFailure = newRetryCount >= MAX_RETRY_ATTEMPTS || !isRetryableError(lastError);

                        logger.error(
                            createLogContext("prepare", itemRequestId, "job-error", {
                                jobId: job.id,
                                retryCount: newRetryCount,
                                isFinal: isFinalFailure
                            }),
                            `Error processing render job${isFinalFailure ? " (final failure)" : " (will retry)"}`,
                            lastError
                        );

                        await prisma.renderJob.update({
                            where: { id: job.id },
                            data: {
                                status: isFinalFailure ? "failed" : "queued",
                                errorMessage: errorMessage.substring(0, 500),
                                errorCode: "PROCESSING_ERROR",
                                retryCount: newRetryCount
                            }
                        });

                        // Emit render_job_failed event
                        if (productAsset?.id) {
                            emitPrepEvent(
                                {
                                    assetId: productAsset.id,
                                    productId: job.productId,
                                    shopId: job.shopId,
                                    eventType: "render_job_failed",
                                    actorType: "system",
                                    payload: {
                                        renderJobId: job.id,
                                        roomSessionId: job.roomSessionId || undefined,
                                        attempt: newRetryCount,
                                        isFinalFailure,
                                        errorMessage: errorMessage.substring(0, 500),
                                        errorCode: "PROCESSING_ERROR",
                                        isRetryable: isRetryableError(lastError),
                                    },
                                },
                                null,
                                itemRequestId
                            ).catch(() => {
                                // Non-critical
                            });
                        }
                    }
                } catch (error) {
                    // Outer error handler for unexpected errors
                    const errorMessage = error instanceof Error ? error.message : "Unknown error";
                    logger.error(
                        createLogContext("prepare", itemRequestId, "job-critical-error", { jobId: job.id }),
                        "Critical error processing render job",
                        error
                    );

                    try {
                        await prisma.renderJob.update({
                            where: { id: job.id },
                            data: {
                                status: "failed",
                                errorMessage: `Critical error: ${errorMessage.substring(0, 450)}`,
                                errorCode: "CRITICAL_ERROR"
                            }
                        });
                    } catch (updateError) {
                        logger.error(
                            createLogContext("prepare", itemRequestId, "job-update-failed", { jobId: job.id }),
                            "Failed to update job status after critical error",
                            updateError
                        );
                    }
                }
            }
        }

        return true;
    } catch (error) {
        logger.error(createLogContext("prepare", batchRequestId, "job-loop-error", {}), "Error in render job loop", error);
        return false;
    }
}

async function runProcessorCycle() {
    if (isProcessing) return;
    isProcessing = true;

    const batchRequestId = generateRequestId();

    // Stale Lock Recovery - reset items stuck in "processing" state
    // Only reset items that haven't exceeded retry limit
    try {
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

        // Reset ProductAssets (increment retry count for each reset)
        const staleAssets = await prisma.productAsset.updateMany({
            where: {
                status: "processing",
                updatedAt: { lt: fifteenMinutesAgo },
                retryCount: { lt: MAX_RETRY_ATTEMPTS }
            },
            data: {
                status: "preparing",
                updatedAt: new Date(),
                errorMessage: "Reset from stale processing state"
            }
        });

        // Mark assets that have exceeded retry limit as failed
        const exhaustedAssets = await prisma.productAsset.updateMany({
            where: {
                status: "processing",
                updatedAt: { lt: fifteenMinutesAgo },
                retryCount: { gte: MAX_RETRY_ATTEMPTS }
            },
            data: {
                status: "failed",
                updatedAt: new Date(),
                errorMessage: "Maximum retry attempts exceeded (stale recovery)"
            }
        });

        // Reset RenderJobs (only those under retry limit)
        const staleJobs = await prisma.renderJob.updateMany({
            where: {
                status: "processing",
                createdAt: { lt: fifteenMinutesAgo },
                retryCount: { lt: MAX_RETRY_ATTEMPTS }
            },
            data: {
                status: "queued"
            }
        });

        // Mark jobs that have exceeded retry limit as failed
        const exhaustedJobs = await prisma.renderJob.updateMany({
            where: {
                status: "processing",
                createdAt: { lt: fifteenMinutesAgo },
                retryCount: { gte: MAX_RETRY_ATTEMPTS }
            },
            data: {
                status: "failed",
                errorMessage: "Maximum retry attempts exceeded (stale recovery)",
                errorCode: "MAX_RETRIES_EXCEEDED"
            }
        });

        if (staleAssets.count > 0 || staleJobs.count > 0 || exhaustedAssets.count > 0 || exhaustedJobs.count > 0) {
            logger.warn(
                createLogContext("prepare", batchRequestId, "stale-recovery", {}),
                `Stale recovery: reset ${staleAssets.count} assets, ${staleJobs.count} jobs; marked failed: ${exhaustedAssets.count} assets, ${exhaustedJobs.count} jobs`
            );
        }
    } catch (error) {
        logger.error(
            createLogContext("prepare", batchRequestId, "stale-recovery-error", {}),
            "Failed to reset stale items",
            error
        );
    }

    await processPendingAssets(batchRequestId);
    await processPendingRenderJobs(batchRequestId);

    isProcessing = false;
}

export function startPrepareProcessor() {
    // Validate required environment variables before starting
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY not configured (fail-hard): cannot start background processor");
    }

    if (!processorInterval) {
        const wrappedProcessor = async () => {
            try {
                await runProcessorCycle();
            } catch (error) {
                // Fail-hard: crash the process so the platform restarts it.
                console.error("Critical error in processor wrapper (fail-hard):", error);
                process.exit(1);
            }
        };
        // Run every 5 seconds
        processorInterval = setInterval(wrappedProcessor, 5000);
        logger.info(createLogContext("system", "startup", "processor-start", {}), "Started background processor");
        wrappedProcessor();
    }
}

export function isProcessorEnabled(): boolean {
    return processorInterval !== null;
}

export function stopPrepareProcessor() {
    if (processorInterval) {
        clearInterval(processorInterval);
        processorInterval = null;
    }
}
