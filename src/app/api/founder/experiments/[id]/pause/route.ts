import { NextResponse } from "next/server";
import { repository } from "@/lib/db/repository";
import { persistAudit, persistExperiment } from "@/lib/db/supabase-persistence";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const current = repository.mustGet(repository.experiments, params.id, "ai_experiment");
  const next = repository.updateExperiment(params.id, { status: "paused", endAt: new Date().toISOString() });
  const audit = repository.audit("founder", "pause", "ai_experiment", params.id, current, next, body.reason);
  await persistExperiment(next);
  await persistAudit(audit);
  return NextResponse.json(next);
}
