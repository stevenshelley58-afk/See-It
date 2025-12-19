import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// POST /api/products/:id/assets/:assetId/default — mark default prepared asset (spec Routes → Admin API)
export const action = async ({ request, params }) => {
    const { session } = await authenticate.admin(request);
    const { id: productId, assetId } = params;

    if (!productId || !assetId) {
        return json({ error: "missing_params" }, { status: 400 });
    }

    const shop = await prisma.shop.findUnique({
        where: { shopDomain: session.shop }
    });

    if (!shop) {
        return json({ error: "shop_not_found" }, { status: 404 });
    }

    const asset = await prisma.productAsset.findFirst({
        where: { id: assetId, shopId: shop.id, productId }
    });

    if (!asset) {
        return json({ error: "asset_not_found" }, { status: 404 });
    }

    // Set this asset as default and unset all other defaults for this product
    // Use transaction to ensure atomicity
    await prisma.$transaction([
        // First, unset all defaults for this shop+product combination
        prisma.productAsset.updateMany({
            where: {
                shopId: shop.id,
                productId: productId
            },
            data: {
                isDefault: false
            }
        }),
        // Then set this asset as the default
        prisma.productAsset.update({
            where: { id: assetId },
            data: {
                isDefault: true,
                updatedAt: new Date()
            }
        })
    ]);

    return json({
        ok: true,
        asset_id: assetId,
        product_id: productId,
        message: "Default asset updated successfully"
    });
};




