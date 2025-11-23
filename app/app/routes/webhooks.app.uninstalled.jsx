import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    // Mark shop as uninstalled instead of deleting
    await db.shop.update({
      where: { shopDomain: shop },
      data: { uninstalledAt: new Date() }
    });

    // Delete sessions
    if (session) {
      await db.session.deleteMany({ where: { shop } });
    }

    console.log(`Marked shop ${shop} as uninstalled`);
    return new Response();
  } catch (error) {
    console.error(`Error handling APP_UNINSTALLED webhook for ${shop}:`, error);
    return new Response();
  }
};
