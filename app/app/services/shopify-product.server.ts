import { logger, createLogContext } from "~/utils/logger.server";

export type ShopifyProductForPrompt = {
  title?: string | null;
  description?: string | null;
  descriptionHtml?: string | null;
  productType?: string | null;
  vendor?: string | null;
  tags?: string[] | null;
  images?: { edges?: Array<{ node?: { url?: string } }> } | null;
  metafields?: {
    edges?: Array<{
      node?: { namespace?: string; key?: string; value?: string; type?: string };
    }>;
  } | null;
};

export async function fetchShopifyProductForPrompt(args: {
  flow: "prepare" | "render";
  shopDomain: string;
  accessToken: string;
  productId: string;
  requestId: string;
}): Promise<ShopifyProductForPrompt | null> {
  const { flow, shopDomain, accessToken, productId, requestId } = args;

  if (!accessToken || accessToken === "pending") return null;

  const endpoint = `https://${shopDomain}/admin/api/2025-01/graphql.json`;
  const query = `#graphql
    query GetProductForPrompt($id: ID!) {
      product(id: $id) {
        title
        description
        descriptionHtml
        productType
        vendor
        tags
        images(first: 3) {
          edges {
            node {
              url
            }
          }
        }
        metafields(first: 20) {
          edges {
            node {
              namespace
              key
              value
              type
            }
          }
        }
      }
    }
  `;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        query,
        variables: { id: `gid://shopify/Product/${productId}` },
      }),
    });

    if (!res.ok) {
      logger.warn(
        createLogContext(flow, requestId, "shopify-product-fetch", {
          status: res.status,
          statusText: res.statusText,
        }),
        `Failed to fetch product from Shopify Admin API (HTTP ${res.status})`
      );
      return null;
    }

    const json = await res.json().catch(() => null);
    return (json?.data?.product as ShopifyProductForPrompt | undefined) || null;
  } catch (err) {
    logger.warn(
      createLogContext(flow, requestId, "shopify-product-fetch", {
        error: err instanceof Error ? err.message : String(err),
      }),
      "Failed to fetch product from Shopify Admin API (network/parsing)"
    );
    return null;
  }
}

