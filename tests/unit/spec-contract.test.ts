import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it, beforeEach } from "vitest";
import { GET as founderAiGet, PATCH as founderAiPatch, POST as founderAiPost } from "@/app/api/founder/ai/[...segments]/route";
import { readEnv, providerSecretStatus } from "@/lib/env";
import { seedAiControlPlane } from "@/lib/ai/bootstrap";
import { hasCapabilities, supportsTask } from "@/lib/ai/capabilities";
import { estimateInvocationCost } from "@/lib/ai/cost";
import { activatePromptDeployment, blockPromptVersionFromProduction, clonePromptVersion, createPromptDraft, editPromptDraft, previewPromptVersion, runOneOffPromptTest, setPromptVersionStatus } from "@/lib/ai/prompt-control";
import { compilePrompt, diffPromptVersions, validatePromptVariables } from "@/lib/ai/prompt-compiler";
import { promptHash } from "@/lib/ai/prompt-hash";
import { providerContractMatrix, listModels, listProviders } from "@/lib/ai/registry";
import { redactSecrets } from "@/lib/ai/redaction";
import { resolveRoutePolicy, selectModelRoute } from "@/lib/ai/route-policy";
import { invokeAi } from "@/lib/ai/router";
import { repository } from "@/lib/db/repository";
import { deterministicAssignment } from "@/lib/experiments/assignment";
import { createFounderSessionToken, isFounderHeaderValid, isFounderPasswordValid, isFounderSessionTokenValid } from "@/lib/founder/auth";
import { enqueueDurableJob, enqueueJob, enqueueRenderJob, leaseJobs } from "@/lib/jobs/queue";
import { runLeasedJob } from "@/lib/jobs/worker";
import { mapBillingPlan } from "@/lib/shopify/billing";
import { authenticateAppProxyParams, createAppProxySignature, enforceAppProxyRateLimit, signShopifyParams, verifyShopifyHmac } from "@/lib/shopify/app-proxy";
import { buildInstallUrl, handleOAuthCallback } from "@/lib/shopify/auth";
import { handlePrivacyWebhook, verifyWebhook } from "@/lib/shopify/webhooks";
import { verifyShopifySessionToken } from "@/lib/shopify/session";
import { assertLifestyleQuota, assertRenderQuota, consumeLifestyleStarted, consumeRenderStarted } from "@/lib/billing/quota";
import { resetRateLimitBuckets } from "@/lib/security/rate-limit";
import { verifyServiceSecret } from "@/lib/security/service-auth";
import { parseGateResult } from "@/lib/render/gate";
import { buildReplayPayload } from "@/lib/render/replay";
import { resolveActiveRecipe } from "@/lib/render/recipes";
import { loadFixtureCase, loadRenderFixtures, scoreEvalResult } from "@/lib/render/evals";
import { roomOriginalPath, productCutoutPath } from "@/lib/storage/paths";
import { createSignedReadUrl, createSignedUpload, verifySignedUpload } from "@/lib/storage/signed-upload";

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

function base64Url(value: unknown) {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
}

function shopifySessionToken(payload: Record<string, unknown>, secret: string) {
  const header = base64Url({ alg: "HS256", typ: "JWT" });
  const body = base64Url(payload);
  const signature = createHmac("sha256", secret).update(header + "." + body).digest("base64url");
  return header + "." + body + "." + signature;
}

function founderAiContext(...segments: string[]) {
  return { params: Promise.resolve({ segments }) };
}

function founderAiRequest(segments: string[], body: Record<string, unknown> = {}) {
  return new NextRequest("https://app.test/api/founder/ai/" + segments.join("/"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" }
  });
}

beforeEach(() => {
  repository.reset();
  resetRateLimitBuckets();
  seedAiControlPlane(repository);
});

describe("unit contract", () => {
  it("parses env and provider secret status", () => {
    expect(readEnv(env()).APP_ENV).toBe("test");
    expect(providerSecretStatus({ ...readEnv(env()), OPENAI_API_KEY: "x" }).openai).toBe(true);
  });

  it("validates founder password and signed session token", async () => {
    const parsed = readEnv(env());
    const token = await createFounderSessionToken(parsed.FOUNDER_PASSWORD, parsed.ENCRYPTION_KEY);
    expect(await isFounderPasswordValid("pw", parsed)).toBe(true);
    expect(await isFounderHeaderValid("pw", parsed)).toBe(true);
    expect(await isFounderPasswordValid("wrong", parsed)).toBe(false);
    expect(await isFounderSessionTokenValid(token, parsed)).toBe(true);
    expect(await isFounderSessionTokenValid("bad", parsed)).toBe(false);
  });

  it("validates service auth for cron and internal job routes", () => {
    expect(verifyServiceSecret({ authorization: "Bearer cron" }, "cron").ok).toBe(true);
    expect(verifyServiceSecret({ headerSecret: "cron" }, "cron").ok).toBe(true);
    expect(verifyServiceSecret({ querySecret: "cron" }, "cron").ok).toBe(true);
    expect(verifyServiceSecret({}, "cron")).toEqual({ ok: false, status: 401, error: "service_auth_required" });
    expect(verifyServiceSecret({ authorization: "Bearer wrong" }, "cron")).toEqual({ ok: false, status: 403, error: "invalid_service_secret" });
  });

  it("validates Shopify embedded merchant session tokens", () => {
    const parsed = readEnv(env());
    const shop = repository.createShop({ shopDomain: "merchant.myshopify.com", plan: "trial", rendersQuota: 50, lifestyleImagesQuota: 10, billingStatus: "trial", roomPreviewEnabled: true });
    const token = shopifySessionToken({ aud: parsed.SHOPIFY_API_KEY, dest: "https://" + shop.shopDomain, exp: 9999999999, nbf: 1 }, parsed.SHOPIFY_API_SECRET);
    const result = verifyShopifySessionToken(token, parsed, 100);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.shop.id).toBe(shop.id);
    }
    const wrongAud = shopifySessionToken({ aud: "wrong", dest: "https://" + shop.shopDomain, exp: 9999999999 }, parsed.SHOPIFY_API_SECRET);
    expect(verifyShopifySessionToken(wrongAud, parsed, 100)).toEqual({ ok: false, status: 403, error: "invalid_session_audience" });
  });

  it("registers providers, models, capabilities, and route policy", () => {
    expect(listProviders().map((p) => p.providerKey)).toContain("gemini");
    const model = listModels()[0];
    expect(hasCapabilities(model, ["image_edit"])).toBe(true);
    expect(supportsTask(model, "render_composite")).toBe(true);
    const policy = resolveRoutePolicy("widget", "render_composite");
    expect(selectModelRoute(policy).model.modelKey).toBe("gemini-3.1-flash-image");
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

  it("manages prompt lifecycle actions through the founder control plane", async () => {
    const template = [...repository.promptTemplates.values()].find((item) => item.name === "shopper_render_composite")!;
    const draft = createPromptDraft({
      promptTemplateId: template.id,
      createdBy: "founder",
      userPromptTemplate: "Render {{productTitle}} at {{tapX}},{{tapY}}.",
      variablesSchema: { required: ["productTitle", "tapX", "tapY"] }
    });
    expect(draft.status).toBe("draft");
    const edited = editPromptDraft(draft.id, { userPromptTemplate: "Render {{productTitle}} true to scale at {{tapX}},{{tapY}}." });
    expect(edited.promptHash).not.toBe(draft.promptHash);
    const preview = previewPromptVersion(edited.id, { productTitle: "Lamp", tapX: 0.3, tapY: 0.8 });
    expect(preview.resolvedUserPrompt).toContain("true to scale");
    const clone = clonePromptVersion(edited.id, "founder", { notes: "benchmark candidate" });
    expect(clone.version).toBeGreaterThan(edited.version);
    expect(setPromptVersionStatus(clone.id, "approved", "founder").approvedBy).toBe("founder");
    expect(diffPromptVersions(edited, clone).from).toBe(edited.id);
    const recipeVersion = [...repository.recipeVersions.values()][0];
    const deployment = activatePromptDeployment({ surface: "widget", taskType: "render_composite", renderRecipeVersionId: recipeVersion.id, actor: "founder", reason: "unit activation" });
    expect(deployment.status).toBe("active");
    const blocked = blockPromptVersionFromProduction([...repository.promptVersions.values()][0].id, "founder", "unit block");
    expect(blocked.promptVersion.status).toBe("archived");
    const testRun = await runOneOffPromptTest({ promptVersionId: clone.id, variables: { productTitle: "Lamp", tapX: 0.3, tapY: 0.8 } });
    expect(testRun.result.ok).toBe(true);
  });

  it("serves the documented founder AI API actions beyond read-only list endpoints", async () => {
    const firstPromptVersion = [...repository.promptVersions.values()][0];
    const activePolicy = [...repository.routePolicies.values()].find((policy) => policy.status === "active" && policy.taskType === "render_composite")!;

    const providerResponse = await founderAiPost(founderAiRequest(["providers"], {
      providerKey: "manual-http",
      displayName: "Manual HTTP",
      adapterKey: "custom-http",
      adapterVersion: "manual-v1",
      status: "disabled",
      secretRef: "CUSTOM_IMAGE_API_KEY"
    }), founderAiContext("providers"));
    expect(providerResponse.status).toBe(200);
    const provider = await providerResponse.json();
    expect(provider.providerKey).toBe("manual-http");

    const patchedProviderResponse = await founderAiPatch(founderAiRequest(["providers", provider.id], { status: "enabled" }), founderAiContext("providers", provider.id));
    expect((await patchedProviderResponse.json()).status).toBe("enabled");

    const modelResponse = await founderAiPost(founderAiRequest(["models"], {
      providerKey: "manual-http",
      modelKey: "manual-render-v1",
      displayName: "Manual Render V1",
      capabilities: ["image_edit", "aspect_ratio_control"],
      allowedTasks: ["render_composite"],
      status: "testing"
    }), founderAiContext("models"));
    expect(modelResponse.status).toBe(200);
    const model = await modelResponse.json();
    expect(model.allowedTasks).toContain("render_composite");

    const patchedModelResponse = await founderAiPatch(founderAiRequest(["models", model.id], { status: "enabled" }), founderAiContext("models", model.id));
    expect((await patchedModelResponse.json()).status).toBe("enabled");

    const bundleResponse = await founderAiPost(founderAiRequest(["bundles"], {
      name: "Founder API bundle",
      surface: "widget",
      status: "review",
      promptVersionMap: { render_composite: firstPromptVersion.id }
    }), founderAiContext("bundles"));
    const { version: bundleVersion } = await bundleResponse.json();
    expect(bundleVersion.status).toBe("review");
    const approvedBundleResponse = await founderAiPost(founderAiRequest(["bundle-versions", bundleVersion.id, "approve"], { reason: "unit approval" }), founderAiContext("bundle-versions", bundleVersion.id, "approve"));
    expect((await approvedBundleResponse.json()).status).toBe("approved");

    const recipeResponse = await founderAiPost(founderAiRequest(["recipes"], {
      name: "Founder API recipe",
      surface: "widget",
      kind: "shopper",
      status: "review",
      promptBundleVersionId: bundleVersion.id,
      modelRoutePolicyId: activePolicy.id,
      gatePolicy: { threshold: 7 },
      retryPolicy: { maxAttempts: 3 }
    }), founderAiContext("recipes"));
    const { version: recipeVersion } = await recipeResponse.json();
    expect(recipeVersion.status).toBe("review");
    const approvedRecipeResponse = await founderAiPost(founderAiRequest(["recipe-versions", recipeVersion.id, "approve"], { reason: "unit approval" }), founderAiContext("recipe-versions", recipeVersion.id, "approve"));
    expect((await approvedRecipeResponse.json()).status).toBe("approved");

    const deploymentResponse = await founderAiPost(founderAiRequest(["deployments"], {
      surface: "widget",
      taskType: "render_composite",
      renderRecipeVersionId: recipeVersion.id,
      reason: "unit deployment"
    }), founderAiContext("deployments"));
    expect((await deploymentResponse.json()).status).toBe("active");

    const testRenderResponse = await founderAiPost(founderAiRequest(["test-render"], {
      promptVersionId: firstPromptVersion.id,
      variables: { productTitle: "Lamp", tapX: 0.5, tapY: 0.7, dimensionsText: "35 x 65 x 35 cm" }
    }), founderAiContext("test-render"));
    expect((await testRenderResponse.json()).result.ok).toBe(true);
    const invocationsAfterFirstTestRender = repository.aiInvocations.size;
    const secondTestRenderResponse = await founderAiPost(founderAiRequest(["test-render"], {
      promptVersionId: firstPromptVersion.id,
      variables: { productTitle: "Lamp", tapX: 0.5, tapY: 0.7, dimensionsText: "35 x 65 x 35 cm" }
    }), founderAiContext("test-render"));
    expect((await secondTestRenderResponse.json()).result.ok).toBe(true);
    expect(repository.aiInvocations.size).toBeGreaterThan(invocationsAfterFirstTestRender);

    const benchmarkResponse = await founderAiPost(founderAiRequest(["benchmark"], { name: "unit benchmark" }), founderAiContext("benchmark"));
    const benchmark = await benchmarkResponse.json();
    expect(benchmark.report.total).toBe(15);
    expect(benchmark.report.passCount).toBeGreaterThanOrEqual(13);
    const secondBenchmarkResponse = await founderAiPost(founderAiRequest(["benchmark"], { name: "unit benchmark repeat" }), founderAiContext("benchmark"));
    const secondBenchmark = await secondBenchmarkResponse.json();
    expect(secondBenchmark.dataset.id).toBe(benchmark.dataset.id);

    const shop = repository.createShop({ shopDomain: "founder-ai-api.myshopify.com", plan: "trial", rendersQuota: 50, lifestyleImagesQuota: 10, billingStatus: "trial", roomPreviewEnabled: true });
    const room = repository.createRoomSession({ shopId: shop.id, source: "widget", roomKey: "rooms/founder/original.jpg", expiresAt: new Date(Date.now() + 86400000).toISOString(), verified: true });
    const sourceRender = repository.createRenderRequest({ traceId: "trace-founder-ai-api", shopId: shop.id, roomSessionId: room.id, kind: "shopper", surface: "widget", status: "done" });
    const replayResponse = await founderAiPost(founderAiRequest(["replay"], { renderRequestId: sourceRender.id, modelKey: "gpt-image-2" }), founderAiContext("replay"));
    const replay = await replayResponse.json();
    expect(replay.sourceRenderRequestId).toBe(sourceRender.id);

    const providersList = await founderAiGet(new NextRequest("https://app.test/api/founder/ai/providers"), founderAiContext("providers"));
    expect((await providersList.json()).providers.some((item: { providerKey: string }) => item.providerKey === "manual-http")).toBe(true);
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
    const durable = await enqueueDurableJob("lifestyle_generate", { shopId: "shop" }, "lifestyle:unit");
    expect(durable.type).toBe("lifestyle_generate");
    const failed = repository.failJob(job.id, "boom", "test");
    expect(failed.status).toBe("queued");
    const renderJob = enqueueRenderJob("missing");
    const leased = repository.leaseJobs("worker", 1).find((item) => item.id === renderJob.id) ?? renderJob;
    const result = await runLeasedJob(leased.id);
    expect(["queued", "dead"]).toContain(result.status);
  });

  it("records founder manual review, eval runs, fixture promotion data, and experiments", () => {
    const shop = repository.createShop({ shopDomain: "founder-records.myshopify.com", plan: "trial", rendersQuota: 50, lifestyleImagesQuota: 10, billingStatus: "trial", roomPreviewEnabled: true });
    const render = repository.createRenderRequest({
      traceId: "trace-founder-records",
      shopId: shop.id,
      kind: "shopper",
      surface: "widget",
      status: "done"
    });
    const review = repository.createManualReview({
      renderRequestId: render.id,
      reviewer: "founder",
      score: 7,
      status: "needs_prompt_work",
      issueTags: ["wrong_scale"]
    });
    expect(review.status).toBe("needs_prompt_work");
    expect([...repository.traceEvents.values()].map((event) => event.eventName)).toContain("manual_review_recorded");
    const dataset = repository.createEvalDataset({ name: "unit_promoted", status: "active" });
    const evalCase = repository.createEvalCase({ evalDatasetId: dataset.id, caseSlug: "case-1", expectedJson: { renderRequestId: render.id } });
    const run = repository.createEvalRun({ evalDatasetId: dataset.id, status: "running", summaryJson: {}, createdBy: "founder" });
    const result = repository.createEvalResult({ evalRunId: run.id, evalCaseId: evalCase.id, automatedScoreJson: { score: 8 }, manualScoreJson: {}, status: "pass" });
    expect(repository.updateEvalRun(run.id, { status: "completed", completedAt: new Date().toISOString() }).status).toBe("completed");
    expect(result.status).toBe("pass");
    const experiment = repository.createExperiment({
      name: "unit model comparison",
      type: "model_test",
      surface: "widget",
      status: "running",
      trafficPercent: 10,
      guardrailJson: {},
      createdBy: "founder"
    });
    const control = repository.createExperimentArm({ experimentId: experiment.id, name: "control", trafficWeight: 50, paramsOverrideJson: {}, status: "active" });
    const variant = repository.createExperimentArm({ experimentId: experiment.id, name: "variant", trafficWeight: 50, paramsOverrideJson: {}, status: "active" });
    const armId = deterministicAssignment("stable-shop-product", [control, variant].map((arm) => ({ id: arm.id, trafficWeight: arm.trafficWeight })));
    const assignment = repository.assignExperiment({ experimentId: experiment.id, armId, assignmentKey: "stable-shop-product" });
    expect(repository.assignExperiment({ experimentId: experiment.id, armId, assignmentKey: "stable-shop-product" }).id).toBe(assignment.id);
    expect(repository.updateExperiment(experiment.id, { status: "paused" }).status).toBe("paused");
  });

  it("builds storage paths and verifies signed uploads", async () => {
    expect(roomOriginalPath("room")).toBe("rooms/room/original.jpg");
    expect(productCutoutPath("shop", "product")).toBe("products/shop/product/cutout-primary.png");
    const upload = await createSignedUpload("room", "room.jpg", "image/jpeg", readEnv(env()));
    expect(upload.expiresAt).toBeTruthy();
    expect(verifySignedUpload({ roomKey: upload.roomKey, mimeType: "image/jpeg" }).ok).toBe(true);
    expect((await createSignedReadUrl("renders", "renders/render/final.png", 3600, readEnv(env()))).url).toContain("renders/renders/render/final.png");
  });

  it("verifies Shopify HMACs, billing, quota, webhooks, gate parsing, replay payloads, evals, and experiment assignment", () => {
    const params = { shop: "demo.myshopify.com", path_prefix: "/apps/see-it", timestamp: "1" };
    const oauthHmac = signShopifyParams(params, "secret");
    expect(verifyShopifyHmac(new URLSearchParams({ ...params, hmac: oauthHmac }), "secret")).toBe(true);
    const hmac = createAppProxySignature(params, "secret");
    expect(verifyShopifyHmac(new URLSearchParams({ ...params, signature: hmac }), "secret")).toBe(true);
    expect(authenticateAppProxyParams(new URLSearchParams({ ...params, signature: hmac }), "secret").ok).toBe(false);
    expect(mapBillingPlan("starter").renders).toBe(150);
    const shop = repository.createShop({ shopDomain: "quota.myshopify.com", plan: "trial", rendersQuota: 1, lifestyleImagesQuota: 1, billingStatus: "trial", roomPreviewEnabled: true });
    expect(assertRenderQuota(shop.id)).toBe(true);
    const signedInstalledShop = createAppProxySignature({ ...params, shop: shop.shopDomain }, "secret");
    const auth = authenticateAppProxyParams(new URLSearchParams({ ...params, shop: shop.shopDomain, signature: signedInstalledShop }), "secret");
    expect(auth.ok).toBe(true);
    if (!auth.ok) {
      throw new Error("expected app proxy auth success");
    }
    for (let i = 0; i < 30; i += 1) {
      expect(enforceAppProxyRateLimit({ headers: new Headers({ "x-forwarded-for": "203.0.113.10" }) }, auth, { roomSessionId: "room-1" }).ok).toBe(true);
    }
    expect(enforceAppProxyRateLimit({ headers: new Headers({ "x-forwarded-for": "203.0.113.10" }) }, auth, { roomSessionId: "room-1" })).toMatchObject({ ok: false, status: 429, error: "rate_limited", scope: "room_session" });
    resetRateLimitBuckets();
    for (let i = 0; i < 60; i += 1) {
      expect(enforceAppProxyRateLimit({ headers: new Headers({ "x-forwarded-for": "203.0.113.11" }) }, auth).ok).toBe(true);
    }
    expect(enforceAppProxyRateLimit({ headers: new Headers({ "x-forwarded-for": "203.0.113.11" }) }, auth)).toMatchObject({ ok: false, status: 429, error: "rate_limited", scope: "ip" });
    expect(consumeRenderStarted(shop.id).rendersQuota).toBe(0);
    expect(repository.getOrCreateUsageMonthly(shop.id).rendersStarted).toBe(1);
    expect(() => assertRenderQuota(shop.id)).toThrow("quota_exhausted");
    expect(assertLifestyleQuota(shop.id)).toBe(true);
    expect(consumeLifestyleStarted(shop.id).lifestyleImagesQuota).toBe(0);
    expect(repository.getOrCreateUsageMonthly(shop.id).lifestyleImagesUsed).toBe(1);
    expect(() => assertLifestyleQuota(shop.id)).toThrow("lifestyle_quota_exhausted");
    expect(authenticateAppProxyParams(new URLSearchParams({ ...params, shop: shop.shopDomain }), "secret").ok).toBe(false);
    expect(handlePrivacyWebhook("customers/data_request", {}).ok).toBe(true);
    const body = JSON.stringify({ shop_domain: shop.shopDomain });
    const webhookHmac = createHmac("sha256", "secret").update(body).digest("base64");
    expect(verifyWebhook(body, webhookHmac, "secret")).toBe(true);
    expect(buildInstallUrl(shop.shopDomain, "state", "key", "https://app.test", ["read_products"])).toContain("/admin/oauth/authorize");
    expect(parseGateResult({ score: 8, detail: { productIdentity: 8, scalePlausibility: 8, placementAccuracy: 8, artifactAbsence: 8, lightingMatch: 8, perspectiveMatch: 8, shadowContact: 8, sceneIntegration: 8, promptCompliance: 8, commercialUsefulness: 8 } }).pass).toBe(true);
    expect(() => buildReplayPayload("missing")).toThrow();
    expect(loadRenderFixtures()).toHaveLength(15);
    expect(loadFixtureCase("shopper-core-01")?.caseSlug).toBe("shopper-core-01");
    expect(scoreEvalResult().status).toBe("pass");
    expect(deterministicAssignment("shop-product-room", [{ id: "a", trafficWeight: 50 }, { id: "b", trafficWeight: 50 }])).toMatch(/[ab]/);
    expect(resolveActiveRecipe("widget", "shopper").recipe.kind).toBe("shopper");
  });

  it("handles Shopify OAuth callback with HMAC and state before storing encrypted offline token", async () => {
    const parsed = readEnv(env());
    const params = { shop: "oauth.myshopify.com", code: "code", state: "state" };
    const hmac = signShopifyParams(params, parsed.SHOPIFY_API_SECRET);
    const url = new URL("https://app.test/api/auth/callback?" + new URLSearchParams({ ...params, hmac }).toString());
    const shop = await handleOAuthCallback(url, parsed, "state");
    expect(shop.shopDomain).toBe(params.shop);
    expect(shop.offlineAccessTokenEncrypted).toBeTruthy();
    await expect(handleOAuthCallback(url, parsed, "wrong")).rejects.toThrow("Invalid Shopify OAuth state");
  });
});
