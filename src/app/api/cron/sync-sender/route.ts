import { NextRequest, NextResponse } from "next/server";
import { enqueueJob } from "@/lib/jobs/queue";
import { authenticateServiceRequest, serviceAuthErrorBody } from "@/lib/security/service-auth";

export async function POST(request: NextRequest) {
  const auth = authenticateServiceRequest(request);
  if (!auth.ok) {
    return NextResponse.json(serviceAuthErrorBody(auth), { status: auth.status });
  }
  const hour = new Date().toISOString().slice(0, 13);
  const job = enqueueJob("sync_sender", { hour }, "sync_sender:" + hour, 80, 3);
  return NextResponse.json({ job });
}

export const GET = POST;
