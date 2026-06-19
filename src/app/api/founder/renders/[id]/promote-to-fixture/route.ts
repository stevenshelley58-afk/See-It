import { NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const bundle = repository.renderBundleForRequest(params.id);
  const dataset = repository.createEvalDataset({
    name: String(body.datasetName ?? "promoted_render_fixtures"),
    description: "Founder-promoted render fixtures",
    status: "active"
  });
  const firstAsset = bundle.assets[0];
  const finalAsset = bundle.assets.find((asset) => asset.role === "final_output") ?? bundle.assets.find((asset) => asset.role === "provider_output");
  const fixture = repository.createEvalCase({
    evalDatasetId: dataset.id,
    caseSlug: String(body.caseSlug ?? "render-" + params.id),
    productAssetKey: bundle.assets.find((asset) => asset.role === "product_cutout" || asset.role === "product_image")?.storageKey,
    cutoutAssetKey: bundle.assets.find((asset) => asset.role === "product_cutout")?.storageKey,
    roomAssetKey: bundle.assets.find((asset) => asset.role === "room_original" || asset.role === "room_normalized")?.storageKey,
    expectedJson: {
      sourceRenderRequestId: params.id,
      traceId: bundle.request.traceId,
      finalAssetKey: finalAsset?.storageKey,
      fallbackAssetKey: firstAsset?.storageKey,
      promptVersionIds: bundle.invocations.map((invocation) => invocation.promptVersionId).filter(Boolean),
      modelIds: bundle.invocations.map((invocation) => invocation.aiModelId)
    },
    notes: typeof body.notes === "string" ? body.notes : undefined
  });
  repository.audit("founder", "promote_to_fixture", "render_request", params.id, bundle.request, fixture, body.reason);
  repository.trace({
    traceId: bundle.request.traceId,
    renderRequestId: bundle.request.id,
    eventName: "render_promoted_to_fixture",
    eventLevel: "info",
    props: { evalDatasetId: dataset.id, evalCaseId: fixture.id }
  });
  return NextResponse.json({ dataset, fixture });
}
