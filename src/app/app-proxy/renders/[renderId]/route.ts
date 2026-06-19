import { NextRequest, NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";
import { loadRenderAssetsForRequest, loadRenderRequestById } from "@/lib/db/supabase-persistence";
import { appProxyErrorBody, authenticateDurableAppProxyRequest, enforceAppProxyRateLimit } from "@/lib/shopify/app-proxy";
import { createSignedReadUrl } from "@/lib/storage/signed-upload";

export async function GET(request: NextRequest, { params }: { params: Promise<{ renderId: string }> }) {
  const { renderId } = await params;
  const auth = await authenticateDurableAppProxyRequest(request);
  if (!auth.ok) {
    return NextResponse.json(appProxyErrorBody(auth), { status: auth.status });
  }
  const render = await loadRenderRequestById(renderId);
  if (!render || render.shopId !== auth.shop.id) {
    return NextResponse.json({ error: "render_not_found" }, { status: 404 });
  }
  const limit = enforceAppProxyRateLimit(request, auth, { roomSessionId: render.roomSessionId });
  if (!limit.ok) {
    return NextResponse.json(appProxyErrorBody(limit), { status: limit.status });
  }
  if (render.status === "done") {
    await loadRenderAssetsForRequest(render.id);
    const asset = [...repository.renderAssets.values()].find((item) => item.id === render.selectedResultAssetId);
    const signed = asset ? await createSignedReadUrl(asset.storageBucket, asset.storageKey) : undefined;
    return NextResponse.json({ status: "done", resultUrl: signed?.url, dimensionsText: "Shown true to size: 35 x 65 x 35 cm", remainingRefinements: render.remainingRefinements });
  }
  if (render.status === "failed") {
    return NextResponse.json({ status: "failed", errorCode: render.finalErrorCode, message: render.finalMessage });
  }
  return NextResponse.json({ status: render.status === "queued" ? "running" : render.status, stage: "Matching the light" });
}
