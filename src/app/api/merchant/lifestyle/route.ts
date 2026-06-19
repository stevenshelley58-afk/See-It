import { NextResponse } from "next/server";
import { enqueueJob } from "@/lib/jobs/queue";

export async function POST() {
  const job = enqueueJob("lifestyle_generate", { source: "merchant" }, "lifestyle:" + crypto.randomUUID());
  return NextResponse.json({ jobId: job.id, status: job.status });
}
