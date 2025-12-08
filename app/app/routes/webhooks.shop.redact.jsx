import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getGcsClient, GCS_BUCKET } from "../utils/gcs-client.server";

const storage = getGcsClient();

/**
 * GDPR Webhook: shop/redact
 *
 * This webhook is called when a shop uninstalls the app and requests
 * that all their data be deleted after the 48-hour window.
 *
 * This handler:
 * 1. Deletes all database records for the shop (cascades to related tables)
 * 2. Deletes all GCS objects for the shop
 *
 * This handler is idempotent - multiple calls are safe (no-op if already deleted).
 */
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`[GDPR] Received ${topic} webhook for ${shop}`);

  try {
    // Find the shop record
    const shopRecord = await db.shop.findUnique({
      where: { shopDomain: shop }
    });

    if (!shopRecord) {
      console.log(`[GDPR] Shop ${shop} not found in database - already deleted or never installed`);
      return new Response(null, { status: 200 });
    }

    const shopId = shopRecord.id;
    console.log(`[GDPR] Starting data deletion for shop ${shop} (ID: ${shopId})`);

    // Step 1: Delete all GCS objects for this shop
    try {
      const bucket = storage.bucket(GCS_BUCKET);

      // Delete all files under rooms/{shopId}/
      const roomsPrefix = `rooms/${shopId}/`;
      console.log(`[GDPR] Deleting GCS objects with prefix: ${roomsPrefix}`);

      const [roomFiles] = await bucket.getFiles({ prefix: roomsPrefix });
      if (roomFiles.length > 0) {
        await Promise.all(roomFiles.map(file => file.delete()));
        console.log(`[GDPR] Deleted ${roomFiles.length} room files from GCS`);
      } else {
        console.log(`[GDPR] No room files found in GCS for prefix: ${roomsPrefix}`);
      }

      // Delete all files under products/{shopId}/
      const productsPrefix = `products/${shopId}/`;
      console.log(`[GDPR] Deleting GCS objects with prefix: ${productsPrefix}`);

      const [productFiles] = await bucket.getFiles({ prefix: productsPrefix });
      if (productFiles.length > 0) {
        await Promise.all(productFiles.map(file => file.delete()));
        console.log(`[GDPR] Deleted ${productFiles.length} product files from GCS`);
      } else {
        console.log(`[GDPR] No product files found in GCS for prefix: ${productsPrefix}`);
      }

      console.log(`[GDPR] Successfully deleted all GCS objects for shop ${shop}`);
    } catch (gcsError) {
      console.error(`[GDPR] Error deleting GCS objects for shop ${shop}:`, gcsError);
      // Continue with database deletion even if GCS deletion fails
    }

    // Step 2: Delete all database records for this shop
    // The Prisma schema has onDelete: Cascade configured, so deleting the Shop
    // will automatically cascade to:
    // - ProductAsset
    // - RoomSession
    // - RenderJob
    // - UsageDaily
    console.log(`[GDPR] Deleting shop record and all related data for ${shop}`);

    await db.shop.delete({
      where: { shopDomain: shop }
    });

    console.log(`[GDPR] Successfully deleted all data for shop ${shop}`);

    // Also delete any sessions for this shop
    try {
      const deletedSessions = await db.session.deleteMany({
        where: { shop }
      });
      console.log(`[GDPR] Deleted ${deletedSessions.count} session(s) for shop ${shop}`);
    } catch (sessionError) {
      console.error(`[GDPR] Error deleting sessions for shop ${shop}:`, sessionError);
    }

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error(`[GDPR] Error handling shop/redact webhook for ${shop}:`, error);
    // Return 500 for unexpected errors so Shopify can retry
    // (but only if we haven't already successfully deleted the shop)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
