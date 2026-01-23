/**
 * GET /api/monitor/v1/runs
 *
 * Paginated list of render runs with filters.
 */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getRuns, type RunListFilters } from "../services/monitor";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  const url = new URL(request.url);

  const filters: RunListFilters = {};

  const status = url.searchParams.get("status");
  if (status) filters.status = status;

  const dateFrom = url.searchParams.get("dateFrom");
  if (dateFrom) filters.dateFrom = new Date(dateFrom);

  const dateTo = url.searchParams.get("dateTo");
  if (dateTo) filters.dateTo = new Date(dateTo);

  const productId = url.searchParams.get("productId");
  if (productId) filters.productId = productId;

  const requestId = url.searchParams.get("requestId");
  if (requestId) filters.requestId = requestId;

  const promptVersion = url.searchParams.get("promptVersion");
  if (promptVersion) filters.promptVersion = parseInt(promptVersion);

  const model = url.searchParams.get("model");
  if (model) filters.model = model;

  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "20");

  const result = await getRuns(shop.id, filters, { page, limit });

  return json(result);
};
