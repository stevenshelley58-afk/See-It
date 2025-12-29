import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { logger, createLogContext } from "../utils/logger.server";
import { generateProductDescription, extractStructuredFields } from "../services/description-writer.server";

/**
 * POST /api/products/generate-description
 *
 * Generate an optimized AI description for product compositing.
 * Called from PlacementTab when merchant clicks "Generate Description".
 *
 * Body (JSON):
 * - product: { title, description, productType, tags }
 * - fields: { surface, orientation, material, shadow, dimensions, additionalNotes }
 */
export const action = async ({ request }) => {
    const requestId = `gen-desc-${Date.now()}`;
    const logContext = createLogContext("api", requestId, "generate-description", {});

    try {
        const { session } = await authenticate.admin(request);
        
        const body = await request.json();
        const { product, fields } = body;

        if (!product?.title) {
            return json({ success: false, error: "Missing product title" }, { status: 400 });
        }

        logger.info(logContext, `Generating description for: ${product.title}`);

        // Generate the description
        const result = await generateProductDescription(
            {
                title: product.title,
                description: product.description,
                productType: product.productType,
                vendor: product.vendor,
                tags: product.tags,
            },
            fields,
            requestId
        );

        logger.info(
            { ...logContext, stage: "complete" },
            `Description generated, confidence: ${result.confidence}`
        );

        return json({
            success: true,
            description: result.description,
            confidence: result.confidence,
            model: result.model,
        });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(logContext, `Generate description failed: ${errorMessage}`, error);

        return json({
            success: false,
            error: errorMessage,
        }, { status: 500 });
    }
};

/**
 * GET /api/products/generate-description?productId=xxx
 *
 * Auto-extract structured fields from product data.
 * Called when merchant opens PlacementTab for the first time.
 */
export const loader = async ({ request }) => {
    const requestId = `extract-${Date.now()}`;
    const logContext = createLogContext("api", requestId, "extract-fields", {});

    try {
        const { session, admin } = await authenticate.admin(request);
        
        const url = new URL(request.url);
        const productId = url.searchParams.get("productId");

        if (!productId) {
            return json({ success: false, error: "Missing productId" }, { status: 400 });
        }

        // Fetch product from Shopify
        const response = await admin.graphql(`
            query getProduct($id: ID!) {
                product(id: $id) {
                    title
                    description
                    productType
                    vendor
                    tags
                }
            }
        `, {
            variables: { id: `gid://shopify/Product/${productId}` }
        });

        const data = await response.json();
        const product = data.data?.product;

        if (!product) {
            return json({ success: false, error: "Product not found" }, { status: 404 });
        }

        // Extract structured fields
        const fields = extractStructuredFields({
            title: product.title,
            description: product.description,
            productType: product.productType,
            tags: product.tags,
        });

        logger.info(logContext, `Extracted fields for ${product.title}: surface=${fields.surface}, material=${fields.material}`);

        return json({
            success: true,
            product: {
                title: product.title,
                description: product.description,
                productType: product.productType,
                vendor: product.vendor,
                tags: product.tags,
            },
            suggestedFields: fields,
        });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(logContext, `Extract fields failed: ${errorMessage}`, error);

        return json({
            success: false,
            error: errorMessage,
        }, { status: 500 });
    }
};
