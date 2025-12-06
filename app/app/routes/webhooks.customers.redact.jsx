import { authenticate } from "../shopify.server";

/**
 * GDPR: customers/redact webhook
 * Delete customer data within 48 hours.
 *
 * Currently See It does NOT track individual customers - we only store:
 * - Room sessions (by shop, not by customer)
 * - Render jobs (by shop, not by customer)
 *
 * If customer tracking is added in the future, this webhook must be updated
 * to delete their RoomSessions, RenderJobs, and GCS files.
 */
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log(`Customer redact request for customer ID: ${payload?.customer?.id}`);

  // Currently no customer-specific data stored
  // See It stores data by shop, not by individual customer
  // If we add customer tracking, we would delete:
  // - Room images from GCS for this customer
  // - RoomSessions where customerId matches
  // - RenderJobs where customerId matches

  return new Response();
};
