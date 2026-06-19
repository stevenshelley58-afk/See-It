import { repository } from "@/lib/db/repository";
import { createSmokeRoom } from "./smoke-utils";

const { product } = await createSmokeRoom("enrich-smoke.myshopify.com");
const enriched = repository.products.get(product.id);
if (!enriched?.cutoutKey || enriched.prepStatus !== "ready") {
  throw new Error("Enrich smoke failed to prepare product cutout metadata");
}
console.log(JSON.stringify({
  productSetupId: enriched.id,
  title: enriched.title,
  dimensionsMm: [enriched.widthMm, enriched.heightMm, enriched.depthMm],
  cutoutKey: enriched.cutoutKey,
  prepStatus: enriched.prepStatus
}, null, 2));
