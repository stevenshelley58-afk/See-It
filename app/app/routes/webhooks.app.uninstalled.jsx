import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`[webhook:uninstalled] Received ${topic} for ${shop}`);

  try {
    // Use updateMany which doesn't throw if no records match
    // This handles the case where shop doesn't exist (e.g., partial install)
    const result = await db.shop.updateMany({
      where: { shopDomain: shop },
      data: { uninstalledAt: new Date() }
    });

    // Delete sessions regardless of whether shop existed
    await db.session.deleteMany({ where: { shop } });

    if (result.count > 0) {
      console.log(`[webhook:uninstalled] Marked shop ${shop} as uninstalled`);
    } else {
      console.log(`[webhook:uninstalled] Shop ${shop} not found, sessions cleaned up`);
    }

    return new Response();
  } catch (error) {
    console.error(`[webhook:uninstalled] Error for ${shop}:`, error);
    // Return 200 to prevent Shopify from retrying
    return new Response();
  }
};
