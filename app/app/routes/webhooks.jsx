import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getGcsClient, GCS_BUCKET } from "../utils/gcs-client.server";

const storage = getGcsClient();

function normalizeTopic(topic) {
  if (!topic) return "";
  const t = String(topic);
  return t.toLowerCase();
}

/**
 * Unified webhook endpoint.
 *
 * Shopify's CLI/config expects GDPR webhooks to be declared via `compliance_topics`,
 * which uses a single `uri`. We accept those topics here and dispatch internally.
 */
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const t = normalizeTopic(topic);

  // GDPR: customers/data_request
  if (t === "customers/data_request" || t === "customers_data_request") {
    console.log(`[GDPR] Received ${topic} webhook for ${shop}`);
    const customerId = payload?.customer?.id;
    const customerEmail = payload?.customer?.email;
    console.log(
      `[GDPR] Customer data request - ID: ${customerId}, Email: ${customerEmail}`,
    );
    console.log(
      `[GDPR] No customer-specific data stored for customer ${customerId} in shop ${shop}`,
    );
    return new Response(null, { status: 200 });
  }

  // GDPR: customers/redact
  if (t === "customers/redact" || t === "customers_redact") {
    console.log(`[GDPR] Received ${topic} webhook for ${shop}`);
    const customerId = payload?.customer?.id;
    const customerEmail = payload?.customer?.email;
    console.log(
      `[GDPR] Customer redaction request - ID: ${customerId}, Email: ${customerEmail}`,
    );
    console.log(
      `[GDPR] No customer-specific data to redact for customer ${customerId} in shop ${shop}`,
    );
    return new Response(null, { status: 200 });
  }

  // GDPR: shop/redact
  if (t === "shop/redact" || t === "shop_redact") {
    console.log(`[GDPR] Received ${topic} webhook for ${shop}`);

    try {
      const shopRecord = await db.shop.findUnique({
        where: { shopDomain: shop },
      });

      if (!shopRecord) {
        console.log(
          `[GDPR] Shop ${shop} not found in database - already deleted or never installed`,
        );
        return new Response(null, { status: 200 });
      }

      const shopId = shopRecord.id;
      console.log(
        `[GDPR] Starting data deletion for shop ${shop} (ID: ${shopId})`,
      );

      // Step 1: Delete all GCS objects for this shop
      try {
        const bucket = storage.bucket(GCS_BUCKET);

        const roomsPrefix = `rooms/${shopId}/`;
        console.log(`[GDPR] Deleting GCS objects with prefix: ${roomsPrefix}`);
        const [roomFiles] = await bucket.getFiles({ prefix: roomsPrefix });
        if (roomFiles.length > 0) {
          await Promise.all(roomFiles.map((file) => file.delete()));
          console.log(`[GDPR] Deleted ${roomFiles.length} room files from GCS`);
        } else {
          console.log(
            `[GDPR] No room files found in GCS for prefix: ${roomsPrefix}`,
          );
        }

        const productsPrefix = `products/${shopId}/`;
        console.log(
          `[GDPR] Deleting GCS objects with prefix: ${productsPrefix}`,
        );
        const [productFiles] = await bucket.getFiles({
          prefix: productsPrefix,
        });
        if (productFiles.length > 0) {
          await Promise.all(productFiles.map((file) => file.delete()));
          console.log(
            `[GDPR] Deleted ${productFiles.length} product files from GCS`,
          );
        } else {
          console.log(
            `[GDPR] No product files found in GCS for prefix: ${productsPrefix}`,
          );
        }

        console.log(
          `[GDPR] Successfully deleted all GCS objects for shop ${shop}`,
        );
      } catch (gcsError) {
        console.error(
          `[GDPR] Error deleting GCS objects for shop ${shop}:`,
          gcsError,
        );
        // Continue with database deletion even if GCS deletion fails
      }

      // Step 2: Delete all database records for this shop (cascades)
      console.log(`[GDPR] Deleting shop record and all related data for ${shop}`);
      await db.shop.delete({
        where: { shopDomain: shop },
      });
      console.log(`[GDPR] Successfully deleted all data for shop ${shop}`);

      // Also delete any sessions for this shop
      try {
        const deletedSessions = await db.session.deleteMany({
          where: { shop },
        });
        console.log(
          `[GDPR] Deleted ${deletedSessions.count} session(s) for shop ${shop}`,
        );
      } catch (sessionError) {
        console.error(`[GDPR] Error deleting sessions for shop ${shop}:`, sessionError);
      }

      return new Response(null, { status: 200 });
    } catch (error) {
      console.error(`[GDPR] Error handling shop/redact webhook for ${shop}:`, error);
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Not expected here, but don't fail webhook delivery.
  console.log(`[webhooks] Received unhandled topic ${topic} for ${shop}`);
  return new Response(null, { status: 200 });
};


