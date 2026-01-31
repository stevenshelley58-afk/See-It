// Temporary diagnostic endpoint - DELETE AFTER USE
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;
const DIAGNOSTIC_DISABLED = process.env.DISABLE_DIAGNOSTIC_ENDPOINT === "true";

async function fetchDiagnostics(shopIdFilter: string | null) {
  // Get all shops with render job counts
  const shops = await prisma.shop.findMany({
    where: shopIdFilter ? { id: shopIdFilter } : {},
    select: {
      id: true,
      shopDomain: true,
      plan: true,
      _count: {
        select: {
          renderJobs: true,
          productAssets: true,
          roomSessions: true,
        },
      },
    },
  });

  // Get recent render jobs
  const recentJobs = await prisma.renderJob.findMany({
    where: shopIdFilter ? { shopId: shopIdFilter } : {},
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      shopId: true,
      status: true,
      createdAt: true,
      productId: true,
      shop: {
        select: { shopDomain: true },
      },
    },
  });

  // Get status counts
  const statusCounts = await prisma.renderJob.groupBy({
    by: ["status"],
    where: shopIdFilter ? { shopId: shopIdFilter } : {},
    _count: true,
  });

  return json({
    shops: shops.map((s: typeof shops[number]) => ({
      id: s.id.substring(0, 8) + "...",
      domain: s.shopDomain,
      plan: s.plan,
      renderJobs: s._count.renderJobs,
      productAssets: s._count.productAssets,
      roomSessions: s._count.roomSessions,
    })),
    recentJobs: recentJobs.map((j: typeof recentJobs[number]) => ({
      id: j.id.substring(0, 8) + "...",
      shopDomain: j.shop?.shopDomain,
      status: j.status,
      createdAt: j.createdAt.toISOString(),
      productId: j.productId?.split("/").pop() || "N/A",
    })),
    statusCounts: statusCounts.reduce((acc: Record<string, number>, s: typeof statusCounts[number]) => {
      acc[s.status] = s._count;
      return acc;
    }, {} as Record<string, number>),
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    if (DIAGNOSTIC_DISABLED) {
      return new Response("Not found", { status: 404 });
    }

    const authHeader = request.headers.get("Authorization");

    // Allow explicit admin API token when configured
    if (ADMIN_API_TOKEN && authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      if (token !== ADMIN_API_TOKEN) {
        return new Response("Unauthorized", { status: 401 });
      }
      return fetchDiagnostics(null);
    }

    // Default: require Shopify admin session and scope to that shop
    const { session } = await authenticate.admin(request);
    const shop = await prisma.shop.findUnique({
      where: { shopDomain: session.shop },
      select: { id: true },
    });

    if (!shop) {
      return new Response("Shop not found", { status: 404 });
    }

    return fetchDiagnostics(shop.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json({ error: message }, { status: 500 });
  }
};
