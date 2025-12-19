import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// POST /api/products/context - Update product context for AI prompts
export const action = async ({ request }) => {
    const { session } = await authenticate.admin(request);
    
    const formData = await request.formData();
    const productId = formData.get("productId");
    const productContext = formData.get("productContext") || "";

    if (!productId) {
        return json({ error: "Product ID required" }, { status: 400 });
    }

    const shop = await prisma.shop.findUnique({
        where: { shopDomain: session.shop }
    });

    if (!shop) {
        return json({ error: "Shop not found" }, { status: 404 });
    }

    // Find or create the product asset
    let asset = await prisma.productAsset.findFirst({
        where: { shopId: shop.id, productId: productId }
    });

    if (asset) {
        // Update existing asset
        asset = await prisma.productAsset.update({
            where: { id: asset.id },
            data: { productContext }
        });
    } else {
        // Create a placeholder asset with context (will be fully created when prepared)
        asset = await prisma.productAsset.create({
            data: {
                shopId: shop.id,
                productId: productId,
                productContext,
                sourceImageId: "pending",
                sourceImageUrl: "",
                status: "pending",
                prepStrategy: "manual",
                promptVersion: 1,
                createdAt: new Date()
            }
        });
    }

    return json({ 
        success: true, 
        message: "Product context saved",
        productContext: asset.productContext 
    });
};

