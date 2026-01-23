/**
 * GET /api/monitor/v1/runs/:id/events
 *
 * Event timeline for a run.
 */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getRunEvents } from "../services/monitor";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;

  if (!id) {
    return json({ error: "Missing run ID" }, { status: 400 });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  const result = await getRunEvents(id, shop.id);

  return json(result);
};
