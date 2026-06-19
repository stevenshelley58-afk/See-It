import { NextRequest, NextResponse } from "next/server";
import { enqueueDurableJob } from "@/lib/jobs/queue";
import { authenticateServiceRequest, serviceAuthErrorBody } from "@/lib/security/service-auth";

export async function POST(request: NextRequest) {
  const auth = authenticateServiceRequest(request);
  if (!auth.ok) {
    return NextResponse.json(serviceAuthErrorBody(auth), { status: auth.status });
  }
  const period = new Date().toISOString().slice(0, 10);
  const job = await enqueueDurableJob("usage_rollup", { period }, "usage_rollup:" + period, 70, 3);
  return NextResponse.json({ job });
}

export const GET = POST;
