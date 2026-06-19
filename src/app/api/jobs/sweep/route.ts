import { NextResponse } from "next/server";
import { sweepJobs } from "@/lib/jobs/worker";

export async function POST() {
  return NextResponse.json({ jobs: await sweepJobs("api") });
}
