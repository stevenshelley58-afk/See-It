/**
 * Shopify Metafield Utilities
 * 
 * Helper functions for managing product metafields via Shopify Admin API.
 */

import { logger } from "./logger.server";

/**
 * Set the See It enabled metafield on a product.
 * 
 * This metafield is used by the storefront Liquid template to conditionally
 * render the "See It Now" button. Only products with enabled=true will show the button.
 * 
 * @param admin - Shopify Admin API context from authenticate.admin()
 * @param productId - Numeric Shopify product ID (e.g., "8324603576460")
 * @param enabled - Whether See It is enabled for this product
 */
export async function setSeeItEnabledMetafield(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  productId: string,
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  const gid = `gid://shopify/Product/${productId}`;
  
  try {
    const response = await admin.graphql(
      `#graphql
      mutation setMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            namespace
            key
            value
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          metafields: [
            {
              ownerId: gid,
              namespace: "see_it",
              key: "enabled",
              value: enabled ? "true" : "false",
              type: "single_line_text_field",
            },
          ],
        },
      }
    );

    const data = await response.json();
    
    if (data.data?.metafieldsSet?.userErrors?.length > 0) {
      const errors = data.data.metafieldsSet.userErrors;
      const errorMsg = errors.map((e: { message: string }) => e.message).join(", ");
      logger.warn(
        { stage: "metafield-set", productId },
        `Metafield userErrors: ${errorMsg}`
      );
      return { success: false, error: errorMsg };
    }

    logger.info(
      { stage: "metafield-set", productId, enabled },
      `Set see_it.enabled metafield to ${enabled}`
    );

    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    logger.error(
      { stage: "metafield-set", productId },
      `Failed to set metafield: ${errorMsg}`,
      error
    );
    return { success: false, error: errorMsg };
  }
}
