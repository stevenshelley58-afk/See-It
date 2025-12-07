import { authenticate } from "../shopify.server";

/**
 * GDPR Webhook: customers/data_request
 *
 * This webhook is called when a customer requests their data from Shopify.
 * Currently, this app does not store any per-customer data:
 * - RoomSession and RenderJob are keyed by shopId, not customerId
 * - No customer PII is stored in the database
 *
 * If customer-specific data is stored in the future, this handler should
 * query and return all data related to the customer.
 *
 * This handler is idempotent - multiple calls with the same payload are safe.
 */
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`[GDPR] Received ${topic} webhook for ${shop}`);

  try {
    // Parse the webhook payload
    const payload = await request.json();
    const customerId = payload.customer?.id;
    const customerEmail = payload.customer?.email;

    console.log(`[GDPR] Customer data request - ID: ${customerId}, Email: ${customerEmail}`);

    // Current implementation: no customer-specific data is stored
    // Log the request for compliance record-keeping
    console.log(`[GDPR] No customer-specific data stored for customer ${customerId} in shop ${shop}`);

    // TODO: If customer-level data is added in the future, query and return it here:
    // - Check RenderJob, RoomSession, ProductAsset for any customer references
    // - Compile data into a structured response
    // - Store or transmit the data as per GDPR requirements

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error(`[GDPR] Error handling customers/data_request webhook for ${shop}:`, error);
    // Return 200 even on error to prevent Shopify retries
    return new Response(null, { status: 200 });
  }
};
