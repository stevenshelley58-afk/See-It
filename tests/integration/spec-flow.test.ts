import { beforeEach, describe, expect, it } from "vitest";
import { seedAiControlPlane } from "@/lib/ai/bootstrap";
import { repository } from "@/lib/db/repository";
import { createProductSetup, setProductEnabled } from "@/lib/merchant/products";
import { createSignedUpload, verifySignedUpload } from "@/lib/storage/signed-upload";
import { createRenderRequest, runRenderPipeline } from "@/lib/render/orchestrator";
import { createReplay } from "@/lib/render/replay";
import { deterministicAssignment } from "@/lib/experiments/assignment";
import { handlePrivacyWebhook, handleUninstall } from "@/lib/shopify/webhooks";
import { PLANS } from "@/lib/shopify/billing";

beforeEach(() => {
  repository.reset();
  seedAiControlPlane(repository);
});

describe("integration flow", () => {
  it("covers install, product sync, render, gate, replay, eval, feedback, privacy, uninstall, and billing quota", async () => {
    const shop = repository.createShop({ shopDomain: "flow.myshopify.com", plan: "trial", rendersQuota: PLANS.trial.renders, lifestyleImagesQuota: PLANS.trial.lifestyleImages, billingStatus: "trial", roomPreviewEnabled: true });
    const product = createProductSetup(shop.id, { gid: "gid://shopify/Product/1", handle: "lamp", title: "Lamp", imageKey: "products/shop/product/source.png" }, { widthMm: 350, heightMm: 650, depthMm: 350 });
    setProductEnabled(product.id, true);
    const room = repository.createRoomSession({ shopId: shop.id, productSetupId: product.id, source: "widget", roomKey: "", expiresAt: new Date(Date.now() + 86400000).toISOString() });
    const upload = createSignedUpload(room.id, "room.jpg", "image/jpeg");
    repository.updateRoomSession(room.id, { roomKey: upload.roomKey, verified: verifySignedUpload({ roomKey: upload.roomKey, mimeType: "image/jpeg" }).ok, width: 1600, height: 1200, normalizedRoomKey: "rooms/" + room.id + "/normalized.jpg" });
    const render = createRenderRequest({ roomSessionId: room.id, tap: { x: 0.42, y: 0.68 } });
    await runRenderPipeline(render.id);
    const bundle = repository.renderBundleForRequest(render.id);
    expect(bundle.request.status).toBe("done");
    expect(bundle.attempts).toHaveLength(1);
    expect(bundle.assets.some((asset) => asset.role === "final_output")).toBe(true);
    expect(bundle.invocations[0].resolvedUserPrompt).toContain("Lamp");
    expect(bundle.trace.map((event) => event.eventName)).toContain("quality_gate_completed");
    const replay = createReplay(render.id, { modelKey: "gpt-image-2" });
    expect(replay.sourceRenderRequestId).toBe(render.id);
    expect(deterministicAssignment(shop.id + product.id + room.id, [{ id: "control", trafficWeight: 50 }, { id: "variant", trafficWeight: 50 }])).toBeTruthy();
    repository.createFeedback({ renderRequestId: render.id, verdict: "down", issueTag: "wrong_scale" });
    expect(repository.feedback.size).toBe(1);
    expect(handlePrivacyWebhook("customers/data_request", { shop_domain: shop.shopDomain }).ok).toBe(true);
    expect(handleUninstall(shop.shopDomain).disabled).toBe(true);
    expect(repository.shops.get(shop.id)?.roomPreviewEnabled).toBe(false);
  });
});
