import { promptHash } from "@/lib/ai/prompt-hash";
import type { InMemoryRepository } from "@/lib/db/repository";

export function seedAiControlPlane(repo: InMemoryRepository) {
  const localProvider = repo.upsertProvider({ providerKey: "local", displayName: "Local deterministic", adapterKey: "local", adapterVersion: "local-deterministic-v1", status: "enabled", notes: "Local bootstrap and tests only" });
  const gemini = repo.upsertProvider({ providerKey: "gemini", displayName: "Gemini", adapterKey: "gemini", adapterVersion: "gemini-image-docs-2026-06-v1", status: "enabled", secretRef: "GEMINI_API_KEY", docsUrl: "https://ai.google.dev/gemini-api/docs/image-generation" });
  const openai = repo.upsertProvider({ providerKey: "openai", displayName: "OpenAI", adapterKey: "openai", adapterVersion: "openai-image-docs-2026-06-v1", status: "enabled", secretRef: "OPENAI_API_KEY", docsUrl: "https://platform.openai.com/docs/guides/images" });
  const custom = repo.upsertProvider({ providerKey: "custom-http", displayName: "Custom HTTP", adapterKey: "custom-http", adapterVersion: "custom-http-v1", status: "disabled", secretRef: "CUSTOM_IMAGE_API_KEY" });
  for (const planned of ["flux", "ideogram", "reve"]) {
    repo.upsertProvider({ providerKey: planned, displayName: planned, adapterKey: planned, adapterVersion: planned + "-planned-v0", status: "disabled" });
  }
  const commonTasks = ["product_dimension_extract", "product_cutout", "room_analysis", "render_composite", "render_refine", "lifestyle_generate", "quality_gate", "prompt_eval", "caption", "personalization"] as const;
  const imageCaps = ["text_to_image", "image_edit", "multi_image_reference", "ordered_image_inputs", "aspect_ratio_control", "size_control", "safety_settings", "sync_response", "json_output", "cost_estimate", "raw_usage", "high_fidelity_reference"];
  repo.upsertModel({ providerId: localProvider.id, providerKey: "local", modelKey: "local-deterministic-image", displayName: "Local deterministic image", status: "enabled", capabilities: [...imageCaps, "seed_control", "negative_prompt"], allowedTasks: [...commonTasks], defaultParams: { outputFormat: "png" }, limits: {}, pricing: { flatUsd: 0 } });
  repo.upsertModel({ providerId: gemini.id, providerKey: "gemini", modelKey: "gemini-3.1-flash-image", displayName: "Gemini 3.1 Flash Image", status: "enabled", capabilities: imageCaps, allowedTasks: ["render_composite", "render_refine", "lifestyle_generate", "product_cutout", "quality_gate", "prompt_eval"], defaultParams: { outputFormat: "png" }, limits: { maxLatencyMs: 90000 }, pricing: { perImageUsd: 0.04 } });
  repo.upsertModel({ providerId: gemini.id, providerKey: "gemini", modelKey: "gemini-3-pro-image", displayName: "Gemini 3 Pro Image", status: "enabled", capabilities: imageCaps, allowedTasks: ["render_composite", "render_refine", "lifestyle_generate", "quality_gate", "prompt_eval"], defaultParams: { outputFormat: "png", quality: "high" }, limits: { maxLatencyMs: 120000 }, pricing: { perImageUsd: 0.12 } });
  repo.upsertModel({ providerId: openai.id, providerKey: "openai", modelKey: "gpt-image-2", displayName: "GPT Image 2", status: "enabled", capabilities: imageCaps, allowedTasks: ["render_composite", "render_refine", "lifestyle_generate", "product_cutout", "quality_gate", "prompt_eval"], defaultParams: { outputFormat: "png" }, limits: { maxLatencyMs: 120000 }, pricing: { perImageUsd: 0.08 } });
  repo.upsertModel({ providerId: custom.id, providerKey: "custom-http", modelKey: "custom-image", displayName: "Custom image endpoint", status: "testing", capabilities: imageCaps, allowedTasks: ["render_composite", "render_refine", "lifestyle_generate"], defaultParams: {}, limits: {}, pricing: { perImageUsd: 0.05 } });

  const policy = repo.upsertRoutePolicy({
    name: "Shopper render launch policy",
    surface: "widget",
    taskType: "render_composite",
    status: "active",
    policy: {
      primary: [{ providerKey: "gemini", modelKey: "gemini-3.1-flash-image" }],
      fallbacks: [{ providerKey: "openai", modelKey: "gpt-image-2", onErrorCodes: ["provider_timeout", "provider_5xx", "provider_bad_response"] }],
      escalation: [{ providerKey: "gemini", modelKey: "gemini-3-pro-image", onGateFail: true }],
      maxAttempts: 3,
      maxCostUsd: 0.75,
      maxLatencyMs: 90000
    }
  });
  repo.upsertRoutePolicy({
    name: "Product cutout launch policy",
    surface: "admin",
    taskType: "product_cutout",
    status: "active",
    policy: {
      primary: [{ providerKey: "gemini", modelKey: "gemini-3.1-flash-image" }],
      fallbacks: [{ providerKey: "openai", modelKey: "gpt-image-2", onErrorCodes: ["provider_timeout", "provider_5xx", "provider_bad_response"] }],
      escalation: [],
      maxAttempts: 2,
      maxCostUsd: 0.5,
      maxLatencyMs: 90000
    }
  });
  repo.upsertRoutePolicy({
    name: "Founder prompt eval launch policy",
    surface: "founder",
    taskType: "prompt_eval",
    status: "active",
    policy: {
      primary: [{ providerKey: "gemini", modelKey: "gemini-3.1-flash-image" }],
      fallbacks: [{ providerKey: "openai", modelKey: "gpt-image-2", onErrorCodes: ["provider_timeout", "provider_5xx", "provider_bad_response"] }],
      escalation: [],
      maxAttempts: 2,
      maxCostUsd: 0.5,
      maxLatencyMs: 90000
    }
  });

  const renderTemplate = repo.createPromptTemplate({ name: "shopper_render_composite", taskType: "render_composite", surface: "widget", description: "Local bootstrap seed. Production prompt text is database data." });
  const promptVersion = repo.createPromptVersion({
    promptTemplateId: renderTemplate.id,
    version: 1,
    status: "approved",
    systemInstruction: "You are composing product imagery for a shopper room preview.",
    developerInstruction: "Preserve product identity, scale, shadows, perspective, and shopper room privacy.",
    userPromptTemplate: "Place {{productTitle}} at tap {{tapX}},{{tapY}} using dimensions {{dimensionsText}}.",
    negativePromptTemplate: "wrong product, impossible scale, floating object, extra furniture",
    variablesSchema: { required: ["productTitle", "tapX", "tapY", "dimensionsText"] },
    outputSchema: {},
    allowedAssetRoles: ["product_cutout", "room_image"],
    requiredAssetOrder: ["room_image", "product_cutout"],
    defaultParams: { outputFormat: "png", size: "1536x1024" },
    promptHash: promptHash({ name: "shopper_render_composite", version: 1 }),
    createdBy: "bootstrap",
    approvedBy: "bootstrap",
    approvedAt: new Date().toISOString(),
    notes: "Local bootstrap seed only"
  });
  const gateTemplate = repo.createPromptTemplate({ name: "shopper_quality_gate", taskType: "quality_gate", surface: "widget", description: "Local bootstrap gate seed." });
  const gateVersion = repo.createPromptVersion({
    promptTemplateId: gateTemplate.id,
    version: 1,
    status: "approved",
    developerInstruction: "Score product identity, scale, placement, lighting, perspective, artifacts, and usefulness.",
    userPromptTemplate: "Evaluate render {{renderId}} against source assets.",
    variablesSchema: { required: ["renderId"] },
    outputSchema: {},
    allowedAssetRoles: ["product_image", "provider_output"],
    requiredAssetOrder: ["product_image", "provider_output"],
    defaultParams: { outputFormat: "png" },
    promptHash: promptHash({ name: "shopper_quality_gate", version: 1 }),
    createdBy: "bootstrap",
    approvedBy: "bootstrap",
    approvedAt: new Date().toISOString(),
    notes: "Local bootstrap seed only"
  });
  const bundle = repo.createBundle({ name: "shopper_render_bundle", surface: "widget", description: "Shopper render flow bundle" });
  const bundleVersion = repo.createBundleVersion({ promptBundleId: bundle.id, version: 1, status: "approved", promptVersionMap: { render_composite: promptVersion.id, quality_gate: gateVersion.id }, bundleHash: promptHash({ render: promptVersion.id, gate: gateVersion.id }) });
  const recipe = repo.createRecipe({ name: "shopper_room_preview", surface: "widget", kind: "shopper", description: "Launch shopper render recipe" });
  const recipeVersion = repo.createRecipeVersion({
    renderRecipeId: recipe.id,
    version: 1,
    status: "active",
    promptBundleVersionId: bundleVersion.id,
    modelRoutePolicyId: policy.id,
    gatePolicy: { minCritical: 6, mean: 7 },
    retryPolicy: { maxAttempts: 3, escalateOnGateFail: true },
    storagePolicy: { shopperGeneratedDays: 7 },
    outputPolicy: { format: "png" },
    recipeHash: promptHash({ recipe: recipe.id, bundle: bundleVersion.id, policy: policy.id })
  });
  repo.createDeployment({ surface: "widget", taskType: "render_composite", renderRecipeVersionId: recipeVersion.id, status: "active", trafficPercent: 100, createdBy: "bootstrap", reason: "initial local bootstrap" });
}
