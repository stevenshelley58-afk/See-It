import { NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const current = repository.mustGet(repository.experiments, params.id, "ai_experiment");
  const next = repository.updateExperiment(params.id, { status: "paused", endAt: new Date().toISOString() });
  repository.audit("founder", "pause", "ai_experiment", params.id, current, next, body.reason);
  return NextResponse.json(next);
}
