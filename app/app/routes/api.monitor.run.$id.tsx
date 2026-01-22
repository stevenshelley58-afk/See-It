// API endpoint to fetch a single RenderRun with its variants

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { StorageService } from "../services/storage.server";

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

  const run = await prisma.renderRun.findFirst({
    where: {
      id,
      shopId: shop.id,
    },
    include: {
      productAsset: {
        select: {
          productTitle: true,
          productId: true,
        },
      },
      variantResults: true,
    },
  });

  if (!run) {
    return json({ error: "Run not found" }, { status: 404 });
  }

  // Generate signed URLs for variant images
  const variantsWithUrls = await Promise.all(
    run.variantResults.map(async (v) => ({
      variantId: v.variantId,
      status: v.status,
      latencyMs: v.latencyMs,
      errorMessage: v.errorMessage,
      imageUrl: v.outputImageKey
        ? await StorageService.getSignedReadUrl(v.outputImageKey, 60 * 60 * 1000)
        : null,
    }))
  );

  return json({
    id: run.id,
    createdAt: run.createdAt.toISOString(),
    productTitle: run.productAsset?.productTitle,
    productId: run.productAsset?.productId,
    status: run.status,
    promptPackVersion: run.promptPackVersion,
    model: run.model,
    totalDurationMs: run.totalDurationMs,
    resolvedFactsJson: run.resolvedFactsJson,
    promptPackJson: run.promptPackJson,
    variants: variantsWithUrls,
  });
};
