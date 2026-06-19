import { describe, expect, it, beforeEach } from "vitest";
import { readEnv, providerSecretStatus } from "@/lib/env";
import { seedAiControlPlane } from "@/lib/ai/bootstrap";
import { hasCapabilities, supportsTask } from "@/lib/ai/capabilities";
import { estimateInvocationCost } from "@/lib/ai/cost";
import { compilePrompt, diffPromptVersions, validatePromptVariables } from "@/lib/ai/prompt-compiler";
import { promptHash } from "@/lib/ai/prompt-hash";
import { providerContractMatrix, listModels, listProviders } from "@/lib/ai/registry";
import { redactSecrets } from "@/lib/ai/redaction";
import { resolveRoutePolicy, selectModelRoute } from "@/lib/ai/route-policy";
import { invokeAi } from "@/lib/ai/router";
import { repository } from "@/lib/db/repository";
import { deterministicAssignment } from "@/lib/experiments/assignment";
import { enqueueJob, enqueueRenderJob, leaseJobs } from "@/lib/jobs/queue";
import { runLeasedJob } from "@/lib/jobs/worker";
import { mapBillingPlan } from "@/lib/shopify/billing";
import { createAppProxySignature, verifyShopifyHmac } from "@/lib/shopify/app-proxy";
import { handlePrivacyWebhook } from "@/lib/shopify/webhooks";
import { assertRenderQuota } from "@/lib/billing/quota";
import { parseGateResult } from "@/lib/render/gate";
import { buildReplayPayload } from "@/lib/render/replay";
import { resolveActiveRecipe } from "@/lib/render/recipes";
import { loadFixtureCase, loadRenderFixtures, scoreEvalResult } from "@/lib/render/evals";
import { roomOriginalPath, productCutoutPath } from "@/lib/storage/paths";
import { createSignedUpload, verifySignedUpload } from "@/lib/storage/signed-upload";

function env() {
  return {
    APP_ENV: "test",
    APP_URL: "http://localhost:3000",
    DATABASE_URL: "postgres://example",
    SUPABASE_URL: "http://localhost:54321",
    SUPABASE_SERVICE_KEY: "service",
    SUPABASE_ANON_KEY: "anon",
    SHOPIFY_API_KEY: "key",
    SHOPIFY_API_SECRET: "secret",
    SHOPIFY_APP_URL: "http://localhost:3000",
    SHOPIFY_API_VERSION: "2026-04",
    FOUNDER_PASSWORD: "pw",
    CRON_SECRET: "cron",
    ENCRYPTION_KEY: "encrypt",
    DEMO_BASE_URL: "http://localhost:3000/demo"
  };
}

beforeEach(() => {
  repository.reset();
  seedAiControlPlane(repository);
});

describe("unit contract", () => {
  it("parses env and provider secret status", () => {
    expect(readEnv(env()).APP_ENV).toBe("test");
    expect(providerSecretStatus({ ...readEnv(env()), OPENAI_API_KEY: "x" }).openai).toBe(true);
  });

  it("registers providers, models, capabilities, and route policy", () => {
    expect(listProviders().map((p) => p.providerKey)).toContain("gemini");
    const model = listModels()[0];
    expect(hasCapabilities(model, ["image_edit"])).toBe(true);
    expect(supportsTask(model, "render_composite")).toBe(true);
    const policy = resolveRoutePolicy("widget", "render_composite");
    expect(selectModelRoute(policy).model.modelKey).toBe("local-deterministic-image");
    expect(providerContractMatrix("render_composite").some((row) => row.adapterExists)).toBe(true);
  });

  it("compiles, validates, hashes, diffs, approves, archives, and rolls back prompts", () => {
    const version = [...repository.promptVersions.values()][0];
    expect(() => validatePromptVariables(version, {})).toThrow("Missing prompt variables");
    const compiled = compilePrompt(version, { productTitle: "Lamp", tapX: 0.4, tapY: 0.6, dimensionsText: "35 x 65 x 35 cm" });
    expect(compiled.resolvedUserPrompt).toContain("Lamp");
    expect(promptHash(compiled)).toHaveLength(64);
    const clone = repository.createPromptVersion({ ...version, id: undefined, version: 2, userPromptTemplate: version.userPromptTemplate + " refined" });
    expect(diffPromptVersions(version, clone).changed.userPromptTemplate).toBe(true);
    repository.updatePromptVersion(clone.id, { status: "approved" });
    expect(repository.promptVersions.get(clone.id)?.status).toBe("approved");
    repository.updatePromptVersion(clone.id, { status: "archived" });
    expect(repository.promptVersions.get(clone.id)?.status).toBe("archived");
    const deployment = [...repository.deployments.values()][0];
    expect(repository.rollbackDeployment(deployment.id, "founder", "test").status).toBe("rolled_back");
  });

  it("redacts invocations, estimates costs, and invokes through router", async () => {
    const version = [...repository.promptVersions.values()][0];
    const compiled = compilePrompt(version, { productTitle: "Lamp", tapX: 0.4, tapY: 0.6, dimensionsText: "35 x 65 x 35 cm" });
    const model = listModels()[0];
    expect(estimateInvocationCost({ traceId: "t", surface: "widget", taskType: "render_composite", providerKey: model.providerKey, modelKey: model.modelKey, promptSnapshot: compiled, assets: [], params: {}, idempotencyKey: "x" }, model)).toBeGreaterThanOrEqual(0);
    expect(redactSecrets({ authorization: "Bearer x", url: "https://x.test?a=1&token=secret" })).toEqual({ authorization: "[redacted]", url: "[redacted-url]" });
    const result = await invokeAi({ traceId: "trace", surface: "widget", taskType: "render_composite", providerKey: "local", modelKey: "local-deterministic-image", promptSnapshot: compiled, assets: [], params: {}, idempotencyKey: "unit-ai" });
    expect(result.result.ok).toBe(true);
    expect(repository.aiInvocations.size).toBe(1);
  });

  it("leases and retries jobs", async () => {
    const job = enqueueJob("daily_digest", {}, "digest");
    expect(leaseJobs("test", 1)[0].id).toBe(job.id);
    const failed = repository.failJob(job.id, "boom", "test");
    expect(failed.status).toBe("queued");
    const renderJob = enqueueRenderJob("missing");
    const leased = repository.leaseJobs("worker", 1).find((item) => item.id === renderJob.id) ?? renderJob;
    const result = await runLeasedJob(leased.id);
    expect(["queued", "dead"]).toContain(result.status);
  });

  it("builds storage paths and verifies signed uploads", () => {
    expect(roomOriginalPath("room")).toBe("rooms/room/original.jpg");
    expect(productCutoutPath("shop", "product")).toBe("products/shop/product/cutout-primary.png");
    const upload = createSignedUpload("room", "room.jpg", "image/jpeg");
    expect(upload.expiresAt).toBeTruthy();
    expect(verifySignedUpload({ roomKey: upload.roomKey, mimeType: "image/jpeg" }).ok).toBe(true);
  });

  it("verifies Shopify HMACs, billing, quota, webhooks, gate parsing, replay payloads, evals, and experiment assignment", () => {
    const params = { shop: "demo.myshopify.com", path_prefix: "/apps/see-it", timestamp: "1" };
    const hmac = createAppProxySignature(params, "secret");
    expect(verifyShopifyHmac(new URLSearchParams({ ...params, hmac }), "secret")).toBe(true);
    expect(mapBillingPlan("starter").renders).toBe(150);
    const shop = repository.createShop({ shopDomain: "quota.myshopify.com", plan: "trial", rendersQuota: 1, lifestyleImagesQuota: 1, billingStatus: "trial", roomPreviewEnabled: true });
    expect(assertRenderQuota(shop.id)).toBe(true);
    expect(handlePrivacyWebhook("customers/data_request", {}).ok).toBe(true);
    expect(parseGateResult({ score: 8, detail: { productIdentity: 8, scalePlausibility: 8, placementAccuracy: 8, artifactAbsence: 8, lightingMatch: 8, perspectiveMatch: 8, shadowContact: 8, sceneIntegration: 8, promptCompliance: 8, commercialUsefulness: 8 } }).pass).toBe(true);
    expect(() => buildReplayPayload("missing")).toThrow();
    expect(loadRenderFixtures()).toHaveLength(15);
    expect(loadFixtureCase("shopper-core-01")?.caseSlug).toBe("shopper-core-01");
    expect(scoreEvalResult().status).toBe("pass");
    expect(deterministicAssignment("shop-product-room", [{ id: "a", trafficWeight: 50 }, { id: "b", trafficWeight: 50 }])).toMatch(/[ab]/);
    expect(resolveActiveRecipe("widget", "shopper").recipe.kind).toBe("shopper");
  });
});
