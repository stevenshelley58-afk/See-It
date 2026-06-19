import type { AiInvocationRequest } from "@/lib/ai/types";
import type { AiModelRecord } from "@/lib/db/schema";

export function estimateInvocationCost(request: AiInvocationRequest, model: AiModelRecord): number {
  const pricing = model.pricing as { flatUsd?: number; perImageUsd?: number; perMegapixelUsd?: number };
  const assetPixels = request.assets.reduce((sum, asset) => sum + (asset.width && asset.height ? asset.width * asset.height : 0), 0);
  const megapixels = assetPixels / 1000000;
  const base = pricing.flatUsd ?? 0;
  const imageCost = pricing.perImageUsd ?? 0.02;
  const megapixelCost = (pricing.perMegapixelUsd ?? 0) * megapixels;
  return Number((base + imageCost + megapixelCost).toFixed(4));
}
