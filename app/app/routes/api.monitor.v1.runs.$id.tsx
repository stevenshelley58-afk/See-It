/**
 * GET /api/monitor/v1/runs/:id
 *
 * Full run detail with variants and signed URLs.
 */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getRunDetail } from "../services/monitor";

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

  const run = await getRunDetail(id, shop.id);

  if (!run) {
    return json({ error: "Run not found" }, { status: 404 });
  }

  return json(run);
};
