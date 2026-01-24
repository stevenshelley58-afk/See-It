// =============================================================================
// Shop Resolver - Resolve shop by UUID or domain name
// =============================================================================

import prisma from "./db";
import { isUUID } from "./api-utils";

export interface ResolvedShop {
  id: string;
  shopDomain: string;
}

/**
 * Resolve a shop identifier (UUID or domain) to a shop record
 * Supports:
 * - Full UUID: ddd3597a-7070-442b-9c8e-f525e8077916
 * - Full domain: bohoem58.myshopify.com
 * - Short domain: bohoem58 (will match bohoem58.myshopify.com)
 * - Special: SYSTEM (system tenant)
 */
export async function resolveShop(
  identifier: string
): Promise<ResolvedShop | null> {
  const trimmed = identifier.trim();

  if (!trimmed) {
    return null;
  }

  // Special case: SYSTEM tenant
  if (trimmed.toUpperCase() === "SYSTEM") {
    const shop = await prisma.shop.findUnique({
      where: { id: "SYSTEM" },
      select: { id: true, shopDomain: true },
    });
    return shop;
  }

  // If it looks like a UUID, look up by ID
  if (isUUID(trimmed)) {
    const shop = await prisma.shop.findUnique({
      where: { id: trimmed },
      select: { id: true, shopDomain: true },
    });
    return shop;
  }

  // Otherwise, treat as domain name
  // Try exact match first
  let shop = await prisma.shop.findUnique({
    where: { shopDomain: trimmed },
    select: { id: true, shopDomain: true },
  });

  if (shop) {
    return shop;
  }

  // Try with .myshopify.com suffix
  if (!trimmed.includes(".")) {
    shop = await prisma.shop.findUnique({
      where: { shopDomain: `${trimmed}.myshopify.com` },
      select: { id: true, shopDomain: true },
    });
  }

  return shop;
}

/**
 * Resolve shop and return the UUID
 * Returns null if shop not found
 */
export async function resolveShopId(identifier: string): Promise<string | null> {
  const shop = await resolveShop(identifier);
  return shop?.id ?? null;
}
