import { invokeAi } from "@/lib/ai/router";
import { compilePrompt } from "@/lib/ai/prompt-compiler";
import { resolveRoutePolicy, selectModelRoute } from "@/lib/ai/route-policy";
import { repository } from "@/lib/db/repository";

export async function generateProductCutout(productSetupId: string) {
  const product = repository.mustGet(repository.products, productSetupId, "product_setup");
  const route = selectModelRoute(resolveRoutePolicy("admin", "product_cutout"));
  const template = repository.createPromptTemplate({ name: "cutout_bootstrap_" + product.id, taskType: "product_cutout", surface: "admin" });
  const version = repository.createPromptVersion({
    promptTemplateId: template.id,
    version: 1,
    status: "approved",
    userPromptTemplate: "Create a clean transparent cutout for {{title}}.",
    variablesSchema: { required: ["title"] },
    outputSchema: {},
    allowedAssetRoles: ["product_image"],
    requiredAssetOrder: ["product_image"],
    defaultParams: { outputFormat: "png" },
    promptHash: product.id,
    createdBy: "system"
  });
  const prompt = compilePrompt(version, { title: product.title });
  const result = await invokeAi({
    traceId: "trace_cutout_" + product.id,
    surface: "admin",
    taskType: "product_cutout",
    providerKey: route.provider.providerKey,
    modelKey: route.model.modelKey,
    promptSnapshot: prompt,
    assets: [{ role: "product_image", storageKey: product.primaryImageKey ?? "products/" + product.id + "/source.png", mimeType: "image/png", order: 1 }],
    params: { outputFormat: "png" },
    idempotencyKey: "cutout:" + product.id
  });
  const outputKey = result.result.outputAssets[0]?.storageKey ?? "products/" + product.shopId + "/" + product.id + "/cutout-primary.png";
  repository.products.set(product.id, { ...product, cutoutKey: outputKey, prepStatus: "ready" });
  return { productSetupId: product.id, cutoutKey: outputKey, aiInvocationId: result.invocationId };
}
