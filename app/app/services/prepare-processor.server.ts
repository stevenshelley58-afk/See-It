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
    buildPromptPack,
    ensurePromptVersion,
} from "./see-it-now/index";

let processorInterval: NodeJS.Timeout | null = null;
let isProcessing = false;

// Configuration for retry logic
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 5000; // 5 seconds base delay

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

interface PlacementConfig {
    renderInstructions: string;
    sceneRole: string | null;
    replacementRule: string | null;
    allowSpaceCreation: boolean | null;
}

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

/**
 * Auto-generate placement configuration using AI vision
 * Analyzes product image and title to create render instructions
 */
async function generatePlacementConfig(
    imageUrl: string,
    productTitle: string,
    productContext: { description?: string; productType?: string; vendor?: string; tags?: string[] } | null,
    requestId: string
): Promise<PlacementConfig | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        logger.warn(
            createLogContext("prepare", requestId, "placement-config-skip", {}),
            "GEMINI_API_KEY not set, skipping placement config generation"
        );
        return null;
    }

    const genAI = new GoogleGenAI({ apiKey });

    try {
        // Fetch the image
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
            throw new Error(`Failed to fetch image: ${imageResponse.status}`);
        }
        const imageBuffer = await imageResponse.arrayBuffer();
        const base64Image = Buffer.from(imageBuffer).toString('base64');
        const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';

        const descriptionSnippet = (productContext?.description || '').toString().replace(/\s+/g, ' ').trim().slice(0, 1200);
        const tagsSnippet = Array.isArray(productContext?.tags) ? productContext!.tags.slice(0, 20).join(', ') : '';

        const prompt = `You are analyzing a product image for an AR/visualization app that places furniture and home decor into customer room photos.

Product Title: "${productTitle}"
Product Type: "${(productContext?.productType || '').toString().trim()}"
Vendor: "${(productContext?.vendor || '').toString().trim()}"
Tags: "${tagsSnippet}"
Product Description (from PDP, may include dimensions/materials): "${descriptionSnippet}"

Analyze this product image and provide:

1. **renderInstructions**: A detailed description for AI image generation. Include:
   - What the product is (material, style, color)
   - How it should be placed in a room (on floor, on wall, on table, etc.)
   - Scale/proportion guidance
   - Any special placement considerations
   - Example: "A solid teak wood dining table with natural grain and tapered legs. Place on floor as main furniture piece. Scale to realistic dining table proportions (approximately 72 inches long). Ensure all four legs contact the floor naturally."

2. **sceneRole**: One of:
   - "floor_furniture" (sofas, tables, chairs, rugs)
   - "wall_art" (paintings, mirrors, wall decor)
   - "tabletop" (vases, lamps, small decor)
   - "lighting" (floor lamps, pendant lights)
   - "outdoor" (garden furniture, planters)

3. **replacementRule**: One of:
   - "replace_similar" (replace similar items in the room)
   - "add_to_scene" (add without replacing anything)
   - "replace_any" (can replace any blocking object)

4. **allowSpaceCreation**: true if the AI can create minimal space/context around the product, false if it should only place in existing space.

Respond in JSON format only, no markdown:
{
    "renderInstructions": "...",
    "sceneRole": "...",
    "replacementRule": "...",
    "allowSpaceCreation": true
}`;

        const result = await genAI.models.generateContent({
            model: "gemini-2.0-flash-exp",
            contents: [
                {
                    role: "user",
                    parts: [
                        { text: prompt },
                        {
                            inlineData: {
                                mimeType: mimeType,
                                data: base64Image
                            }
                        }
                    ]
                }
            ]
        });

        const responseText = result.text || '';

        // Extract JSON from response (handle markdown code blocks)
        let jsonStr = responseText;
        const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
            jsonStr = jsonMatch[1];
        } else {
            const rawJsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (rawJsonMatch) {
                jsonStr = rawJsonMatch[0];
            }
        }

        const config = JSON.parse(jsonStr);

        logger.info(
            createLogContext("prepare", requestId, "placement-config-generated", {
                sceneRole: config.sceneRole,
                hasInstructions: !!config.renderInstructions
            }),
            `Auto-generated placement config: sceneRole=${config.sceneRole}`
        );

        return {
            renderInstructions: config.renderInstructions || null,
            sceneRole: config.sceneRole || null,
            replacementRule: config.replacementRule || null,
            allowSpaceCreation: config.allowSpaceCreation ?? true
        };
    } catch (error) {
        logger.error(
            createLogContext("prepare", requestId, "placement-config-error", {
                error: error instanceof Error ? error.message : String(error)
            }),
            "Failed to generate placement config",
            error
        );
        return null;
    }
}

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
                    // NEW: See It Now 2-LLM Pipeline
                    // ========================================================================

                    // Get current prompt version
                    let promptPackVersion = 0;
                    try {
                        promptPackVersion = await ensurePromptVersion();
                    } catch (versionError) {
                        logger.warn(
                            createLogContext("prepare", itemRequestId, "prompt-version-failed", {}),
                            `Failed to ensure prompt version: ${versionError instanceof Error ? versionError.message : String(versionError)}`
                        );
                    }

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

                    // Step 1: Extract product facts (LLM #1)
                    let extractedFacts = null;
                    try {
                        const extractionInput = {
                            title: shopifyProduct?.title || asset.productTitle || "",
                            description: combinedDescription || "",
                            productType: shopifyProduct?.productType || asset.productType || null,
                            vendor: shopifyProduct?.vendor || null,
                            tags: (shopifyProduct?.tags || []) as string[],
                            metafields: metafieldsRecord,
                            imageUrls: Array.from(uniqueImages),
                        };

                        extractedFacts = await extractProductFacts(extractionInput, itemRequestId);

                        logger.info(
                            createLogContext("prepare", itemRequestId, "extraction-complete", {
                                productKind: extractedFacts.identity?.product_kind,
                                scaleClass: extractedFacts.relative_scale?.class,
                            }),
                            `Extraction complete for ${asset.productId}`
                        );
                    } catch (extractError) {
                        logger.warn(
                            createLogContext("prepare", itemRequestId, "extraction-failed", {}),
                            `Extraction failed for ${asset.productId}, continuing with legacy flow: ${extractError instanceof Error ? extractError.message : String(extractError)}`
                        );
                    }

                    // Step 2: Resolve facts (merge with any existing merchant overrides)
                    let resolvedFacts = null;
                    if (extractedFacts) {
                        const merchantOverrides = asset.merchantOverrides as any || null;
                        resolvedFacts = resolveProductFacts(extractedFacts, merchantOverrides);
                    }

                    // Step 3: Build prompt pack (LLM #2)
                    let promptPack = null;
                    if (resolvedFacts) {
                        try {
                            promptPack = await buildPromptPack(resolvedFacts, itemRequestId);

                            logger.info(
                                createLogContext("prepare", itemRequestId, "prompt-pack-complete", {
                                    variantCount: promptPack.variants.length,
                                }),
                                `Prompt pack built for ${asset.productId}`
                            );
                        } catch (buildError) {
                            logger.warn(
                                createLogContext("prepare", itemRequestId, "prompt-pack-failed", {}),
                                `Prompt pack build failed for ${asset.productId}: ${buildError instanceof Error ? buildError.message : String(buildError)}`
                            );
                        }
                    }

                    // ========================================================================
                    // LEGACY: Generate placement fields and prose prompt (only if not merchant-owned)
                    // Check fieldSource to avoid overwriting merchant edits
                    const existingFieldSource = asset.fieldSource && typeof asset.fieldSource === 'object'
                        ? asset.fieldSource as Record<string, string>
                        : {};

                    const isMerchantOwned = (field: string) => existingFieldSource[field] === 'merchant';

                    // Only generate if renderInstructions is missing or if it's not merchant-owned
                    let renderInstructions = asset.renderInstructions;
                    let placementFields = asset.placementFields && typeof asset.placementFields === 'object'
                        ? asset.placementFields as Record<string, any>
                        : null;
                    let sceneRole = asset.sceneRole;
                    let replacementRule = asset.replacementRule;
                    let allowSpaceCreation = asset.allowSpaceCreation;

                    // Note: shopRecord, shopifyProduct, metafieldText, combinedDescription
                    // are already fetched above in the new 2-LLM pipeline section

                    // NEW: Auto-generate placement config using image analysis if not already set
                    if (!renderInstructions && !isMerchantOwned('renderInstructions')) {
                        try {
                            const placementConfig = await generatePlacementConfig(
                                asset.sourceImageUrl,
                                asset.productTitle || '',
                                {
                                    description: combinedDescription || undefined,
                                    productType: shopifyProduct?.productType || asset.productType || undefined,
                                    vendor: shopifyProduct?.vendor || undefined,
                                    tags: (shopifyProduct?.tags || []) as any,
                                },
                                itemRequestId
                            );

                            if (placementConfig) {
                                renderInstructions = placementConfig.renderInstructions;
                                sceneRole = placementConfig.sceneRole || sceneRole;
                                replacementRule = placementConfig.replacementRule || replacementRule;
                                allowSpaceCreation = placementConfig.allowSpaceCreation ?? allowSpaceCreation;

                                // Emit event for monitor
                                await emitPrepEvent({
                                    assetId: asset.id,
                                    productId: asset.productId,
                                    shopId: asset.shopId,
                                    eventType: "placement_config_generated",
                                    actorType: "system",
                                    payload: {
                                        sceneRole: sceneRole,
                                        replacementRule: replacementRule,
                                        hasInstructions: !!renderInstructions,
                                    }
                                }, null, itemRequestId).catch(() => { });
                            }
                        } catch (promptError) {
                            logger.warn(
                                createLogContext("prepare", itemRequestId, "placement-config", {
                                    error: promptError instanceof Error ? promptError.message : String(promptError)
                                }),
                                "Placement config generation failed, continuing without"
                            );
                        }
                    }

                    // Generate placement if missing and not merchant-owned
                    // Check each field individually so we can generate missing parts even if some exist
                    const shouldGeneratePrompt = !renderInstructions && !isMerchantOwned('renderInstructions');

                    // For placementFields, check if it exists and if any field is merchant-owned
                    const placementFieldsSource = placementFields?.fieldSource && typeof placementFields.fieldSource === 'object'
                        ? placementFields.fieldSource as Record<string, string>
                        : {};
                    const hasMerchantOwnedPlacementField = Object.values(placementFieldsSource).some(src => src === 'merchant');
                    const shouldGenerateFields = (!placementFields || Object.keys(placementFields).filter(k => k !== 'fieldSource').length === 0) && !hasMerchantOwnedPlacementField;

                    const shouldGeneratePlacementRules = (!sceneRole || !replacementRule || allowSpaceCreation === null) &&
                        (!isMerchantOwned('sceneRole') && !isMerchantOwned('replacementRule') && !isMerchantOwned('allowSpaceCreation'));

                    const shouldGeneratePlacement = (shouldGeneratePrompt || shouldGenerateFields || shouldGeneratePlacementRules);

                    if (shouldGeneratePlacement && asset.productTitle) {
                        try {
                            // Extract structured fields from product title (best effort without full product data)
                            // Enhanced: include PDP descriptionHtml + metafields when available.
                            const productData = {
                                title: (shopifyProduct?.title || asset.productTitle || '').toString(),
                                description: combinedDescription || '',
                                productType: shopifyProduct?.productType || asset.productType || null,
                                tags: shopifyProduct?.tags || [],
                            };

                            const extractedFields = extractStructuredFields(productData);

                            // Auto-detect placement rules (same logic as PlacementTab)
                            const largeItemKeywords = ['sofa', 'couch', 'sectional', 'mirror', 'cabinet', 'dresser', 'bookshelf', 'bed', 'table', 'desk', 'console', 'credenza', 'sideboard'];
                            const titleLower = (asset.productTitle || '').toLowerCase();
                            const isLargeItem = largeItemKeywords.some(k => titleLower.includes(k));

                            const autoSceneRole = isLargeItem ? 'Dominant' : 'Integrated';
                            const autoReplacementRule = isLargeItem ? 'Similar Size or Position' : 'None';
                            const autoAllowSpaceCreation = isLargeItem;

                            // Generate prose placement prompt (only if missing and not merchant-owned)
                            if (shouldGeneratePrompt) {
                                try {
                                    const promptResult = await generateProductDescription(
                                        productData,
                                        extractedFields,
                                        itemRequestId
                                    );
                                    renderInstructions = promptResult.description;

                                    logger.info(
                                        createLogContext("prepare", itemRequestId, "placement-prompt-generated", {
                                            assetId: asset.id,
                                            productId: asset.productId,
                                            length: renderInstructions.length
                                        }),
                                        `Generated placement prompt: ${renderInstructions.substring(0, 100)}...`
                                    );

                                    // Emit placement_prompt_generated event with raw text-model prompt for lineage
                                    if (promptResult.rawPrompt) {
                                        emitPrepEvent(
                                            {
                                                assetId: asset.id,
                                                productId: asset.productId,
                                                shopId: asset.shopId,
                                                eventType: "placement_prompt_generated",
                                                actorType: "system",
                                                payload: {
                                                    source: "auto",
                                                    model: promptResult.model,
                                                    confidence: promptResult.confidence,
                                                    description: promptResult.description,
                                                    rawPrompt: promptResult.rawPrompt, // Full prompt sent to text model
                                                    descriptionLength: promptResult.description.length,
                                                },
                                            },
                                            null,
                                            itemRequestId
                                        ).catch(() => {
                                            // Non-critical
                                        });
                                    }
                                } catch (promptError) {
                                    logger.warn(
                                        createLogContext("prepare", itemRequestId, "placement-prompt-failed", {
                                            error: promptError instanceof Error ? promptError.message : String(promptError)
                                        }),
                                        "Placement prompt generation failed, continuing without",
                                        promptError
                                    );
                                    // Fallback: use a basic description
                                    const article = /^[aeiou]/i.test(asset.productTitle) ? 'An' : 'A';
                                    renderInstructions = `${article} ${asset.productTitle.toLowerCase()}, described for realistic interior photography with accurate proportions and natural lighting.`;
                                }
                            }

                            // Set placementFields if not already set and not merchant-owned
                            if (shouldGenerateFields) {
                                placementFields = {
                                    surface: extractedFields.surface,
                                    material: extractedFields.material,
                                    orientation: extractedFields.orientation,
                                    shadow: extractedFields.shadow || (extractedFields.surface === 'ceiling' ? 'none' : 'contact'),
                                    dimensions: extractedFields.dimensions || { height: null, width: null },
                                    additionalNotes: '',
                                    fieldSource: {
                                        surface: 'auto',
                                        material: 'auto',
                                        orientation: 'auto',
                                        shadow: 'auto',
                                        dimensions: 'auto',
                                        additionalNotes: 'auto',
                                    }
                                };
                            }

                            // Set placement rules if not already set and not merchant-owned
                            if (shouldGeneratePlacementRules) {
                                if (!sceneRole && !isMerchantOwned('sceneRole')) {
                                    sceneRole = autoSceneRole;
                                }
                                if (!replacementRule && !isMerchantOwned('replacementRule')) {
                                    replacementRule = autoReplacementRule;
                                }
                                if (allowSpaceCreation === null && !isMerchantOwned('allowSpaceCreation')) {
                                    allowSpaceCreation = autoAllowSpaceCreation;
                                }
                            }

                            // Emit auto_placement_generated event
                            await emitPrepEvent(
                                {
                                    assetId: asset.id,
                                    productId: asset.productId,
                                    shopId: asset.shopId,
                                    eventType: "auto_placement_generated",
                                    actorType: "system",
                                    payload: {
                                        source: "auto",
                                        hasPrompt: !!renderInstructions,
                                        hasPlacementFields: !!placementFields,
                                        sceneRole: sceneRole,
                                        replacementRule: replacementRule,
                                    },
                                },
                                null,
                                itemRequestId
                            ).catch(() => {
                                // Non-critical
                            });

                        } catch (placementError) {
                            logger.warn(
                                createLogContext("prepare", itemRequestId, "placement-generation", {
                                    error: placementError instanceof Error ? placementError.message : String(placementError)
                                }),
                                "Placement generation failed, continuing without",
                                placementError
                            );
                        }
                    }

                    // Extract GCS key from the signed URL for on-demand URL generation
                    const preparedImageKey = extractGcsKeyFromUrl(prepareResult.url);

                    // Prepare update data (only include fields that changed or are being set)
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

                        // NEW: See It Now 2-LLM Pipeline fields
                        ...(extractedFacts && { extractedFacts }),
                        ...(resolvedFacts && { resolvedFacts }),
                        ...(promptPack && { promptPack }),
                        ...(promptPackVersion > 0 && { promptPackVersion }),
                        ...(extractedFacts && { extractedAt: new Date() }),
                    };

                    // Only update renderInstructions if we generated one or if it was already set
                    if (renderInstructions) {
                        updateData.renderInstructions = renderInstructions;
                    }

                    // Only update placementFields if we generated one
                    if (placementFields) {
                        updateData.placementFields = placementFields;
                    }

                    // Only update placement rules if we have values
                    if (sceneRole) {
                        updateData.sceneRole = sceneRole;
                    }
                    if (replacementRule) {
                        updateData.replacementRule = replacementRule;
                    }
                    if (allowSpaceCreation !== null && allowSpaceCreation !== undefined) {
                        updateData.allowSpaceCreation = allowSpaceCreation;
                    }

                    // Update fieldSource to mark auto-generated fields
                    const updatedFieldSource = { ...existingFieldSource };
                    if (renderInstructions && !isMerchantOwned('renderInstructions')) {
                        updatedFieldSource.renderInstructions = 'auto';
                    }
                    if (placementFields && !isMerchantOwned('placementFields')) {
                        updatedFieldSource.placementFields = 'auto';
                    }
                    if (sceneRole && !isMerchantOwned('sceneRole')) {
                        updatedFieldSource.sceneRole = 'auto';
                    }
                    if (replacementRule && !isMerchantOwned('replacementRule')) {
                        updatedFieldSource.replacementRule = 'auto';
                    }
                    if (allowSpaceCreation !== null && !isMerchantOwned('allowSpaceCreation')) {
                        updatedFieldSource.allowSpaceCreation = 'auto';
                    }
                    if (Object.keys(updatedFieldSource).length > 0) {
                        updateData.fieldSource = updatedFieldSource;
                    }

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
                        where: { shopId: job.shopId, productId: job.productId }
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

                            // compositeScene now returns { imageUrl, imageKey }
                            compositeResult = await compositeScene(
                                productImageUrl,
                                roomImageUrl,
                                placement,
                                job.stylePreset ?? "neutral",
                                itemRequestId,
                                productAsset?.renderInstructions ?? undefined,
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

const SEE_IT_NOW_PIPELINE_BACKFILL_INTERVAL_MS = 20_000;
let lastSeeItNowPipelineBackfillAt = 0;

/**
 * Best-effort backfill for See It Now v2 pipeline fields on live assets.
 *
 * Why: older live assets can exist without extractedFacts/resolvedFacts/promptPack
 * (e.g., prepared before v2 shipped). Those assets cause /app-proxy/see-it-now/render
 * to return 422 "pipeline_not_ready". This keeps the storefront working without
 * forcing merchants to re-prepare products.
 */
async function processMissingSeeItNowPipeline(batchRequestId: string): Promise<boolean> {
    const now = Date.now();
    if (now - lastSeeItNowPipelineBackfillAt < SEE_IT_NOW_PIPELINE_BACKFILL_INTERVAL_MS) {
        return false;
    }

    // Throttle DB polling even when there is nothing to do.
    lastSeeItNowPipelineBackfillAt = now;

    try {
        const allowlist = getSeeItNowAllowedShops();
        const allowedShopIds = allowlist.allowAll
            ? null
            : (
                await prisma.shop.findMany({
                    where: { shopDomain: { in: allowlist.shops } },
                    select: { id: true },
                })
            ).map((s: any) => s.id);

        if (Array.isArray(allowedShopIds) && allowedShopIds.length === 0) return false;

        const asset = await prisma.productAsset.findFirst({
            where: {
                status: "live",
                ...(Array.isArray(allowedShopIds) ? { shopId: { in: allowedShopIds } } : {}),
                OR: [
                    { extractedFacts: { equals: Prisma.DbNull } },
                    { resolvedFacts: { equals: Prisma.DbNull } },
                    { promptPack: { equals: Prisma.DbNull } },
                ],
            },
            orderBy: { updatedAt: "asc" },
            select: {
                id: true,
                shopId: true,
                productId: true,
                productTitle: true,
                productType: true,
                sourceImageUrl: true,
                preparedImageUrl: true,
                extractedFacts: true,
                merchantOverrides: true,
                resolvedFacts: true,
                promptPack: true,
                promptPackVersion: true,
                shop: {
                    select: {
                        shopDomain: true,
                        accessToken: true,
                    },
                },
            },
        });

        if (!asset) return false;
        if (asset.shop?.shopDomain && !isSeeItNowAllowedShop(asset.shop.shopDomain)) return false;

        const itemRequestId = generateRequestId();
        const shopDomain = asset.shop?.shopDomain || "(unknown-shop)";
        const accessToken = asset.shop?.accessToken || null;

        logger.info(
            createLogContext("prepare", itemRequestId, "pipeline-backfill-start", {
                assetId: asset.id,
                shopId: asset.shopId,
                productId: asset.productId,
                shopDomain,
            }),
            `Backfilling See It Now pipeline for live product ${asset.productId}`
        );

        const shopifyProduct = accessToken
            ? await fetchShopifyProductForPrompt(shopDomain, accessToken, asset.productId, itemRequestId)
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

        // Collect up to 3 unique images (starting with stored URLs).
        const uniqueImages = new Set<string>();
        if (asset.sourceImageUrl && asset.sourceImageUrl !== "pending") uniqueImages.add(asset.sourceImageUrl);
        if (asset.preparedImageUrl && asset.preparedImageUrl !== "pending") uniqueImages.add(asset.preparedImageUrl);

        if (Array.isArray(shopifyProduct?.images?.edges)) {
            for (const edge of shopifyProduct!.images!.edges!) {
                const url = edge?.node?.url;
                if (url) uniqueImages.add(url);
                if (uniqueImages.size >= 3) break;
            }
        }

        const title = shopifyProduct?.title || asset.productTitle || `Product ${asset.productId}`;
        if (!title || uniqueImages.size === 0) {
            logger.warn(
                createLogContext("prepare", itemRequestId, "pipeline-backfill-skip", {
                    shopDomain,
                    hasTitle: !!title,
                    imageCount: uniqueImages.size,
                }),
                "Skipping See It Now pipeline backfill: insufficient product data"
            );
            return false;
        }

        const extractionInput = {
            title,
            description: combinedDescription || "",
            productType: shopifyProduct?.productType || asset.productType || null,
            vendor: shopifyProduct?.vendor || null,
            tags: (shopifyProduct?.tags || []) as string[],
            metafields: metafieldsRecord,
            imageUrls: Array.from(uniqueImages),
        };

        const needsExtract = !asset.extractedFacts;
        const extractedFacts = (asset.extractedFacts as any) || await extractProductFacts(extractionInput, itemRequestId);
        const merchantOverrides = (asset.merchantOverrides as any) || null;
        const resolvedFacts = resolveProductFacts(extractedFacts, merchantOverrides);
        const promptPackVersion = await ensurePromptVersion();
        const promptPack = await buildPromptPack(resolvedFacts, itemRequestId);

        await prisma.productAsset.update({
            where: { id: asset.id },
            data: {
                extractedFacts,
                resolvedFacts,
                promptPack,
                promptPackVersion,
                ...(needsExtract && { extractedAt: new Date() }),
                ...(shopifyProduct?.title && { productTitle: shopifyProduct.title }),
                ...(shopifyProduct?.productType && { productType: shopifyProduct.productType }),
            },
        });

        logger.info(
            createLogContext("prepare", itemRequestId, "pipeline-backfill-complete", {
                assetId: asset.id,
                shopDomain,
                productId: asset.productId,
                promptPackVersion,
            }),
            `Backfilled See It Now pipeline for live product ${asset.productId}`
        );

        return true;
    } catch (error) {
        logger.warn(
            createLogContext("prepare", batchRequestId, "pipeline-backfill-error", {}),
            `See It Now pipeline backfill failed: ${error instanceof Error ? error.message : String(error)}`
        );
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

    const didAssets = await processPendingAssets(batchRequestId);
    const didJobs = await processPendingRenderJobs(batchRequestId);

    // Only attempt v2 pipeline backfills when the system is otherwise idle.
    if (!didAssets && !didJobs) {
        await processMissingSeeItNowPipeline(batchRequestId);
    }

    isProcessing = false;
}

// Flag to track if processor is disabled due to missing configuration
let processorDisabled = false;

export function startPrepareProcessor() {
    // Validate required environment variables before starting
    if (!process.env.GEMINI_API_KEY) {
        if (!processorDisabled) {
            logger.warn(
                createLogContext("system", "startup", "processor-disabled", {}),
                "GEMINI_API_KEY not configured. Background processor disabled. " +
                "Product preparation and render jobs will not be processed until API key is set."
            );
            processorDisabled = true;
        }
        return; // Gracefully exit without starting processor
    }

    if (!processorInterval) {
        const wrappedProcessor = async () => {
            try {
                await runProcessorCycle();
            } catch (error) {
                console.error("Critical error in processor wrapper:", error);
                isProcessing = false;
            }
        };
        // Run every 5 seconds
        processorInterval = setInterval(wrappedProcessor, 5000);
        logger.info(createLogContext("system", "startup", "processor-start", {}), "Started background processor");
        wrappedProcessor();
    }
}

export function isProcessorEnabled(): boolean {
    return !processorDisabled && processorInterval !== null;
}

export function stopPrepareProcessor() {
    if (processorInterval) {
        clearInterval(processorInterval);
        processorInterval = null;
    }
}
