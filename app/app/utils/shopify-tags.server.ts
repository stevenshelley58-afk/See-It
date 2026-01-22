/**
 * Shopify Product Tag Utilities
 * 
 * Helper functions for managing product tags via Shopify Admin API.
 * Tags are used to control "See It" button visibility on the storefront.
 */

import { logger } from "./logger.server";

const SEE_IT_LIVE_TAG = "see-it-live";

/**
 * Add or remove the "see-it-live" tag from a product.
 * 
 * This tag is checked by the storefront Liquid template to conditionally
 * render the "See It" button. Only products with this tag will show the button.
 * 
 * @param admin - Shopify Admin API context from authenticate.admin()
 * @param productId - Numeric Shopify product ID (e.g., "8324603576460")
 * @param enabled - Whether to add (true) or remove (false) the tag
 */
export async function setSeeItLiveTag(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  productId: string,
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  const gid = `gid://shopify/Product/${productId}`;

  try {
    if (enabled) {
      // Add the tag
      const response = await admin.graphql(
        `#graphql
        mutation addTag($id: ID!, $tags: [String!]!) {
          tagsAdd(id: $id, tags: $tags) {
            node {
              id
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            id: gid,
            tags: [SEE_IT_LIVE_TAG],
          },
        }
      );

      const data = await response.json();

      if (data.data?.tagsAdd?.userErrors?.length > 0) {
        const errors = data.data.tagsAdd.userErrors;
        const errorMsg = errors.map((e: { message: string }) => e.message).join(", ");
        logger.warn(
          { stage: "tag-add", productId, flow: "system", requestId: "internal" },
          `Tag add userErrors: ${errorMsg}`
        );
        return { success: false, error: errorMsg };
      }

      logger.info(
        { stage: "tag-add", productId, flow: "system", requestId: "internal" },
        `Added "${SEE_IT_LIVE_TAG}" tag to product`
      );
    } else {
      // Remove the tag
      const response = await admin.graphql(
        `#graphql
        mutation removeTag($id: ID!, $tags: [String!]!) {
          tagsRemove(id: $id, tags: $tags) {
            node {
              id
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            id: gid,
            tags: [SEE_IT_LIVE_TAG],
          },
        }
      );

      const data = await response.json();

      if (data.data?.tagsRemove?.userErrors?.length > 0) {
        const errors = data.data.tagsRemove.userErrors;
        const errorMsg = errors.map((e: { message: string }) => e.message).join(", ");
        logger.warn(
          { stage: "tag-remove", productId, flow: "system", requestId: "internal" },
          `Tag remove userErrors: ${errorMsg}`
        );
        return { success: false, error: errorMsg };
      }

      logger.info(
        { stage: "tag-remove", productId, flow: "system", requestId: "internal" },
        `Removed "${SEE_IT_LIVE_TAG}" tag from product`
      );
    }

    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    logger.error(
      { stage: enabled ? "tag-add" : "tag-remove", productId, flow: "system", requestId: "internal" },
      `Failed to ${enabled ? "add" : "remove"} tag: ${errorMsg}`,
      error
    );
    return { success: false, error: errorMsg };
  }
}

/**
 * Export the tag name for reference
 */
export { SEE_IT_LIVE_TAG };
