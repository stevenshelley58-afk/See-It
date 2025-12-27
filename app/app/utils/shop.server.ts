/**
 * Shop utilities with proper error handling and logging
 */

import prisma from "../db.server";
import { logger, createLogContext } from "./logger.server";
import { getRequestId } from "./request-context.server";

export interface ShopSession {
  shop: string;
  shopId: string;
}

/**
 * Get shop record from session, with proper error handling and logging
 * Throws controlled errors that should be caught by error boundaries
 */
export async function getShopFromSession(
  session: { shop: string } | null,
  request: Request,
  flow: "prepare" | "render" | "auth" | "shopify-sync" = "auth"
): Promise<ShopSession> {
  const requestId = getRequestId(request);

  if (!session || !session.shop) {
    const error = new Error("Session or shop missing from authentication");
    logger.error(
      createLogContext(flow, requestId, "auth", {}),
      "Shop authentication failed: session or shop is null",
      error
    );
    throw new Response(
      JSON.stringify({ 
        error: "Authentication required", 
        requestId,
        details: "Shop session not found"
      }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop }
  });

  if (!shop) {
    const error = new Error(`Shop domain ${session.shop} not found in database`);
    logger.error(
      createLogContext(flow, requestId, "auth", {}),
      "Shop not found in database",
      error
    );
    throw new Response(
      JSON.stringify({ 
        error: "Shop not found", 
        requestId,
        shopDomain: session.shop
      }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  return {
    shop: session.shop,
    shopId: shop.id,
  };
}






