import { NextRequest, NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";
import { appProxyErrorBody, authenticateAppProxyRequest } from "@/lib/shopify/app-proxy";
import { createSignedReadUrl } from "@/lib/storage/signed-upload";

export async function GET(request: NextRequest, { params }: { params: { renderId: string } }) {
  const auth = authenticateAppProxyRequest(request);
  if (!auth.ok) {
    return NextResponse.json(appProxyErrorBody(auth), { status: auth.status });
  }
  const render = repository.mustGet(repository.renderRequests, params.renderId, "render_request");
  if (render.shopId !== auth.shop.id) {
    return NextResponse.json({ error: "render_not_found" }, { status: 404 });
  }
  if (render.status === "done") {
    const asset = [...repository.renderAssets.values()].find((item) => item.id === render.selectedResultAssetId);
    const signed = asset ? await createSignedReadUrl(asset.storageBucket, asset.storageKey) : undefined;
    return NextResponse.json({ status: "done", resultUrl: signed?.url, dimensionsText: "Shown true to size: 35 x 65 x 35 cm", remainingRefinements: render.remainingRefinements });
  }
  if (render.status === "failed") {
    return NextResponse.json({ status: "failed", errorCode: render.finalErrorCode, message: render.finalMessage });
  }
  return NextResponse.json({ status: render.status === "queued" ? "running" : render.status, stage: "Matching the light" });
}
