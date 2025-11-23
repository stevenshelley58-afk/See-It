import { authenticate } from "../shopify.server";
import db from "../db.server";
import { PLANS } from "../billing";

export const action = async ({ request }) => {
  const { shop, session, admin, topic } = await authenticate.webhook(request);
  
  console.log(`Received ${topic} webhook for ${shop}`);
  
  try {
    // Check if shop already exists
    let shopRecord = await db.shop.findUnique({
      where: { shopDomain: shop }
    });
    
    if (!shopRecord) {
      // Get shop details from Shopify
      const shopResponse = await admin.graphql(
        `#graphql
          query {
            shop {
              id
              email
              name
              currencyCode
            }
          }
        `
      );
      
      const shopData = await shopResponse.json();
      const shopifyShopId = shopData.data.shop.id.replace('gid://shopify/Shop/', '');
      
      // Create new shop record
      shopRecord = await db.shop.create({
        data: {
          shopDomain: shop,
          shopifyShopId: shopifyShopId,
          accessToken: session?.accessToken || "pending",
          plan: PLANS.FREE.id,
          dailyQuota: PLANS.FREE.dailyQuota,
          monthlyQuota: PLANS.FREE.monthlyQuota
        }
      });
      
      console.log(`Created shop record for ${shop}`);
    } else {
      // Update existing shop record if needed
      await db.shop.update({
        where: { shopDomain: shop },
        data: {
          accessToken: session?.accessToken || shopRecord.accessToken,
          uninstalledAt: null // Clear uninstalled date if reinstalling
        }
      });
      
      console.log(`Updated shop record for ${shop}`);
    }
    
    return new Response();
  } catch (error) {
    console.error(`Error handling APP_INSTALLED webhook for ${shop}:`, error);
    return new Response("Error processing webhook", { status: 500 });
  }
};
