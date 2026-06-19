import { NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";

export async function GET(_request: Request, { params }: { params: { renderId: string } }) {
  const render = repository.mustGet(repository.renderRequests, params.renderId, "render_request");
  if (render.status === "done") {
    return NextResponse.json({ status: "done", resultUrl: "https://supabase.local/signed/" + render.selectedResultAssetId, dimensionsText: "Shown true to size: 35 x 65 x 35 cm", remainingRefinements: render.remainingRefinements });
  }
  if (render.status === "failed") {
    return NextResponse.json({ status: "failed", errorCode: render.finalErrorCode, message: render.finalMessage });
  }
  return NextResponse.json({ status: render.status === "queued" ? "running" : render.status, stage: "Matching the light" });
}
