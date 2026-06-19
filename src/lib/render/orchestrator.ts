import { compilePrompt } from "@/lib/ai/prompt-compiler";
import { invokeAi } from "@/lib/ai/router";
import { resolveRoutePolicy, selectModelRoute } from "@/lib/ai/route-policy";
import { repository } from "@/lib/db/repository";
import type { ProductSetupRecord, RenderRequestRecord, RoomSessionRecord } from "@/lib/db/schema";
import { assetHash, renderAssetPath } from "@/lib/render/image-assets";
import { deterministicGate } from "@/lib/render/gate";
import { resolveActiveRecipe } from "@/lib/render/recipes";
import { traceRender } from "@/lib/render/trace";
import { enqueueRenderJob } from "@/lib/jobs/queue";

export type StartRenderInput = {
  roomSessionId: string;
  tap: { x: number; y: number };
  kind?: "shopper" | "lifestyle" | "demo" | "test" | "replay" | "eval";
  sourceRenderRequestId?: string;
  hintText?: string;
};

function dimensionsText(product: ProductSetupRecord) {
  return Math.round(product.widthMm / 10) + " x " + Math.round(product.heightMm / 10) + " x " + Math.round(product.depthMm / 10) + " cm";
}

export function createRenderRequest(input: StartRenderInput) {
  const room = repository.mustGet(repository.roomSessions, input.roomSessionId, "room_session");
  const traceId = "trace_" + crypto.randomUUID();
  const record = repository.createRenderRequest({
    traceId,
    shopId: room.shopId,
    roomSessionId: room.id,
    productSetupId: room.productSetupId,
    sourceRenderRequestId: input.sourceRenderRequestId,
    kind: input.kind ?? "shopper",
    surface: input.kind === "replay" ? "founder" : "widget",
    status: "queued",
    tapX: input.tap.x,
    tapY: input.tap.y,
    hintText: input.hintText
  });
  traceRender(traceId, "render_request_created", { roomSessionId: room.id, tap: input.tap }, record.id);
  enqueueRenderJob(record.id);
  return record;
}

export async function runRenderPipeline(renderRequestId: string) {
  const request = repository.mustGet(repository.renderRequests, renderRequestId, "render_request");
  const room = request.roomSessionId ? repository.mustGet(repository.roomSessions, request.roomSessionId, "room_session") : undefined;
  const product = room?.productSetupId ? repository.mustGet(repository.products, room.productSetupId, "product_setup") : demoProduct(request, room);
  repository.updateRenderRequest(request.id, { status: "running" });
  traceRender(request.traceId, "product_cutout_selected", { cutoutKey: product.cutoutKey ?? "products/demo/cutout-primary.png" }, request.id);
  const { recipeVersion } = resolveActiveRecipe(request.surface === "founder" ? "widget" : request.surface, request.kind === "replay" ? "shopper" : request.kind);
  const bundleVersion = repository.mustGet(repository.bundleVersions, recipeVersion.promptBundleVersionId, "prompt_bundle_version");
  const promptVersionId = bundleVersion.promptVersionMap.render_composite;
  const promptVersion = repository.mustGet(repository.promptVersions, promptVersionId, "prompt_version");
  traceRender(request.traceId, "prompt_bundle_resolved", { promptBundleVersionId: bundleVersion.id, promptVersionId }, request.id);
  const compiled = compilePrompt(promptVersion, {
    productTitle: product.title,
    tapX: request.tapX ?? 0.5,
    tapY: request.tapY ?? 0.5,
    dimensionsText: dimensionsText(product)
  });
  const policy = resolveRoutePolicy("widget", "render_composite");
  const route = selectModelRoute(policy);
  traceRender(request.traceId, "model_route_selected", { provider: route.provider.providerKey, model: route.model.modelKey }, request.id);
  const attempt = repository.createRenderAttempt({
    renderRequestId: request.id,
    attemptNumber: request.attemptCount + 1,
    providerId: route.provider.id,
    aiModelId: route.model.id,
    renderRecipeVersionId: recipeVersion.id,
    promptBundleVersionId: bundleVersion.id,
    status: "running"
  });
  repository.updateRenderRequest(request.id, { attemptCount: attempt.attemptNumber });
  const result = await invokeAi({
    traceId: request.traceId,
    surface: request.surface,
    taskType: "render_composite",
    providerKey: route.provider.providerKey,
    modelKey: route.model.modelKey,
    promptSnapshot: {
      ...compiled,
      promptBundleVersionId: bundleVersion.id,
      renderRecipeVersionId: recipeVersion.id
    },
    assets: [
      { role: "room_image", storageKey: room?.normalizedRoomKey ?? room?.roomKey ?? "rooms/demo/normalized.jpg", mimeType: "image/jpeg", width: room?.width ?? 1600, height: room?.height ?? 1200, order: 1 },
      { role: "product_cutout", storageKey: product.cutoutKey ?? "products/demo/cutout-primary.png", mimeType: "image/png", width: 800, height: 800, order: 2 }
    ],
    params: { ...promptVersion.defaultParams, outputFormat: "png" },
    idempotencyKey: request.id + ":attempt:" + attempt.attemptNumber
  });
  repository.updateRenderAttempt(attempt.id, { aiInvocationId: result.invocationId, status: result.result.ok ? "provider_done" : "failed", errorCode: result.result.error?.code, errorMessage: result.result.error?.message, latencyMs: result.result.latencyMs, costEstimateUsd: result.result.costEstimateUsd });
  if (!result.result.ok) {
    repository.updateRenderRequest(request.id, { status: "failed", finalErrorCode: result.result.error?.code ?? "provider_bad_response", finalMessage: friendlyError(result.result.error?.code) });
    traceRender(request.traceId, "render_failed", { errorCode: result.result.error?.code }, request.id, "error");
    return repository.renderBundleForRequest(request.id);
  }
  const output = result.result.outputAssets.find((asset) => asset.role === "image") ?? result.result.outputAssets[0];
  const storageKey = output.storageKey ?? renderAssetPath(request.id, attempt.attemptNumber, "provider-output");
  const asset = repository.createRenderAsset({
    renderRequestId: request.id,
    renderAttemptId: attempt.id,
    aiInvocationId: result.invocationId,
    role: "provider_output",
    storageBucket: "renders",
    storageKey,
    mimeType: output.mimeType ?? "image/png",
    width: output.width,
    height: output.height,
    sha256: output.sha256 ?? assetHash(storageKey),
    retentionExpiresAt: new Date(Date.now() + 7 * 86400000).toISOString()
  });
  traceRender(request.traceId, "provider_output_stored", { storageKey }, request.id);
  traceRender(request.traceId, "quality_gate_started", { assetId: asset.id }, request.id);
  const gate = deterministicGate(8.2);
  traceRender(request.traceId, "quality_gate_completed", { pass: gate.pass, score: gate.score }, request.id);
  if (!gate.pass) {
    repository.updateRenderAttempt(attempt.id, { status: "rejected", gateScore: gate.score, gateDetail: gate.detail });
    repository.updateRenderRequest(request.id, { status: "failed", finalGateScore: gate.score, finalErrorCode: "gate_rejected", finalMessage: friendlyError("gate_rejected") });
    traceRender(request.traceId, "render_rejected", { gate }, request.id, "warn");
    return repository.renderBundleForRequest(request.id);
  }
  const finalAsset = repository.createRenderAsset({
    renderRequestId: request.id,
    renderAttemptId: attempt.id,
    aiInvocationId: result.invocationId,
    role: "final_output",
    storageBucket: "renders",
    storageKey: renderAssetPath(request.id, attempt.attemptNumber, "final"),
    mimeType: "image/png",
    width: asset.width,
    height: asset.height,
    sha256: assetHash(renderAssetPath(request.id, attempt.attemptNumber, "final")),
    retentionExpiresAt: new Date(Date.now() + 7 * 86400000).toISOString()
  });
  repository.updateRenderAttempt(attempt.id, { status: "accepted", resultAssetId: finalAsset.id, gateScore: gate.score, gateDetail: gate.detail });
  repository.updateRenderRequest(request.id, { status: "done", selectedResultAssetId: finalAsset.id, finalGateScore: gate.score, completedAt: new Date().toISOString() });
  traceRender(request.traceId, "render_accepted", { assetId: finalAsset.id, gateScore: gate.score }, request.id);
  traceRender(request.traceId, "render_result_signed", { storageKey: finalAsset.storageKey }, request.id);
  return repository.renderBundleForRequest(request.id);
}

function demoProduct(request: RenderRequestRecord, room?: RoomSessionRecord): ProductSetupRecord {
  return {
    id: request.productSetupId ?? "demo-product",
    shopId: room?.shopId ?? "demo-shop",
    shopifyProductGid: "gid://shopify/Product/demo",
    title: "Demo accent chair",
    widthMm: 700,
    heightMm: 820,
    depthMm: 760,
    category: "chair",
    material: "fabric",
    colour: "green",
    cutoutKey: "products/demo/cutout-primary.png",
    prepStatus: "ready",
    enabled: true
  };
}

export function friendlyError(code?: string) {
  if (code === "gate_rejected") {
    return "We couldn't get this one right. Try another photo or retry.";
  }
  if (code === "quota_exhausted") {
    return "This store has reached its preview limit.";
  }
  return "We couldn't finish this preview. Try again shortly.";
}
