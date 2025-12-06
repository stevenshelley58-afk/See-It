import { authenticate } from "../shopify.server";
import db from "../db.server";
import { Storage } from "@google-cloud/storage";

/**
 * GDPR: shop/redact webhook
 * Delete ALL shop data within 48 hours after uninstall.
 *
 * This webhook is triggered 48 hours after app uninstall.
 * Must delete:
 * - All GCS files (room images, product assets)
 * - All database records (RenderJobs, RoomSessions, ProductAssets, UsageDaily, Shop)
 */
export const action = async ({ request }) => {
  const { shop: shopDomain, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shopDomain}`);

  try {
    const shop = await db.shop.findUnique({
      where: { shopDomain }
    });

    if (!shop) {
      console.log(`Shop ${shopDomain} not found in database, nothing to delete`);
      return new Response();
    }

    console.log(`Deleting all data for shop ${shopDomain} (ID: ${shop.id})`);

    // Delete GCS files for this shop
    try {
      const bucketName = process.env.GCS_BUCKET || 'see-it-room';
      let storage;

      // Initialize GCS client
      if (process.env.GOOGLE_CREDENTIALS_JSON) {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
        storage = new Storage({ credentials });
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        storage = new Storage();
      } else {
        console.warn('No GCS credentials found, skipping file deletion');
        storage = null;
      }

      if (storage) {
        const bucket = storage.bucket(bucketName);

        // Delete room images: rooms/{shopId}/*
        const [roomFiles] = await bucket.getFiles({ prefix: `rooms/${shop.id}/` });
        for (const file of roomFiles) {
          await file.delete().catch(err => console.warn(`Failed to delete ${file.name}:`, err.message));
        }
        console.log(`Deleted ${roomFiles.length} room files`);

        // Delete product assets: products/{shopId}/*
        const [productFiles] = await bucket.getFiles({ prefix: `products/${shop.id}/` });
        for (const file of productFiles) {
          await file.delete().catch(err => console.warn(`Failed to delete ${file.name}:`, err.message));
        }
        console.log(`Deleted ${productFiles.length} product files`);
      }
    } catch (gcsError) {
      console.error('GCS deletion error (continuing with DB deletion):', gcsError);
    }

    // Delete all database records for this shop
    // Order matters due to foreign key constraints
    await db.renderJob.deleteMany({ where: { shopId: shop.id } });
    console.log('Deleted RenderJobs');

    await db.roomSession.deleteMany({ where: { shopId: shop.id } });
    console.log('Deleted RoomSessions');

    await db.productAsset.deleteMany({ where: { shopId: shop.id } });
    console.log('Deleted ProductAssets');

    await db.usageDaily.deleteMany({ where: { shopId: shop.id } });
    console.log('Deleted UsageDaily');

    // Finally delete the shop record
    await db.shop.delete({ where: { id: shop.id } });
    console.log(`Deleted shop record for ${shopDomain}`);

    console.log(`GDPR shop/redact complete for ${shopDomain}`);
    return new Response();

  } catch (error) {
    console.error(`Error handling SHOP_REDACT webhook for ${shopDomain}:`, error);
    // Return 200 anyway - Shopify will retry on error, and we don't want infinite retries
    return new Response();
  }
};
