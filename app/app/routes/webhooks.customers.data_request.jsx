import { authenticate } from "../shopify.server";

/**
 * GDPR: customers/data_request webhook
 * Customer requests their data. Must return all data stored about them.
 *
 * Currently See It does NOT track individual customers - we only store:
 * - Room sessions (by shop, not by customer)
 * - Render jobs (by shop, not by customer)
 *
 * If customer tracking is added in the future, this webhook must be updated
 * to return their RoomSessions and RenderJobs.
 */
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log(`Customer data request for customer ID: ${payload?.customer?.id}`);

  // Currently no customer-specific data stored
  // See It stores data by shop, not by individual customer
  // If we add customer tracking, we would query:
  // - RoomSessions where customerId matches
  // - RenderJobs where customerId matches

  return new Response();
};
