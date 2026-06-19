import { NextRequest, NextResponse } from "next/server";
import { sweepJobs } from "@/lib/jobs/worker";
import { authenticateServiceRequest, serviceAuthErrorBody } from "@/lib/security/service-auth";

export async function POST(request: NextRequest) {
  const auth = authenticateServiceRequest(request);
  if (!auth.ok) {
    return NextResponse.json(serviceAuthErrorBody(auth), { status: auth.status });
  }
  return NextResponse.json({ jobs: await sweepJobs("api") });
}
