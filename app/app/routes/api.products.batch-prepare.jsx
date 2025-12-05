import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enforceQuota } from "../quota.server";
import { prepareProduct } from "../services/gemini.server";

export const action = async ({ request }) => {
    const { admin, session } = await authenticate.admin(request);
    const formData = await request.formData();
    const productIdsJson = formData.get("productIds");

    if (!productIdsJson) {
        return json({ error: "Missing productIds" }, { status: 400 });
    }

    let productIds;
    try {
        productIds = JSON.parse(productIdsJson);
    } catch (e) {
        return json({ error: "Invalid productIds format" }, { status: 400 });
    }

    if (!Array.isArray(productIds) || productIds.length === 0) {
        return json({ error: "productIds must be a non-empty array" }, { status: 400 });
    }

    const shop = await prisma.shop.findUnique({
        where: { shopDomain: session.shop }
    });

    if (!shop) {
        return json({ error: "Shop not found" }, { status: 404 });
    }

    // Enforce quota for the entire batch
    try {
        await enforceQuota(shop.id, "prep", productIds.length);
    } catch (error) {
        if (error instanceof Response) {
            const data = await error.json();
            return json(data, { status: 429 });
        }
        throw error;
    }

    let processed = 0;
    const errors = [];

    for (const productId of productIds) {
        try {
            // Fetch product details from Shopify GraphQL
            const response = await admin.graphql(
                `#graphql
                query getProduct($id: ID!) {
                  product(id: $id) {
                    id
                    featuredImage {
                      id
                      url
                    }
                  }
                }`,
                {
                    variables: { id: productId }
                }
            );

            const responseJson = await response.json();
            const product = responseJson.data?.product;

            if (!product || !product.featuredImage) {
                errors.push({ productId, error: "No featured image found" });
                continue;
            }

            const imageId = product.featuredImage.id;
            const imageUrl = product.featuredImage.url;

            // Check if asset already exists
            let assetId;
            const existing = await prisma.productAsset.findFirst({
                where: {
                    shopId: shop.id,
                    productId: String(productId)
                }
            });

            if (existing) {
                assetId = existing.id;
                // Update existing asset to pending with batch strategy
                await prisma.productAsset.update({
                    where: { id: existing.id },
                    data: {
                        status: "pending",
                        prepStrategy: "batch",
                        sourceImageUrl: String(imageUrl),
                        sourceImageId: String(imageId),
                        updatedAt: new Date()
                    }
                });
            } else {
                // Create new asset with batch strategy
                const newAsset = await prisma.productAsset.create({
                    data: {
                        shopId: shop.id,
                        productId: String(productId),
                        sourceImageId: String(imageId),
                        sourceImageUrl: String(imageUrl),
                        status: "pending",
                        prepStrategy: "batch",
                        promptVersion: 1,
                        createdAt: new Date()
                    }
                });
                assetId = newAsset.id;
            }

            // Process the image immediately using local Gemini service
            console.log(`[BatchPrepare] Processing product ${productId}...`);
            const preparedImageUrl = await prepareProduct(
                String(imageUrl),
                shop.id,
                String(productId),
                assetId
            );

            // Update as ready
            await prisma.productAsset.update({
                where: { id: assetId },
                data: {
                    status: "ready",
                    preparedImageUrl: preparedImageUrl,
                    updatedAt: new Date()
                }
            });

            processed++;
            console.log(`[BatchPrepare] Successfully processed ${productId}`);

        } catch (error) {
            console.error(`[BatchPrepare] Error processing product ${productId}:`, error);
            errors.push({
                productId,
                error: error.message || "Unknown error"
            });
        }
    }

    return json({
        processed,
        errors,
        message: `Processed ${processed} products${errors.length > 0 ? `, ${errors.length} failed` : ''}`
    });
};
