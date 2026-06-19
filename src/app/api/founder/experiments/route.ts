import { NextRequest, NextResponse } from "next/server";
import { deterministicAssignment } from "@/lib/experiments/assignment";

export async function GET() {
  return NextResponse.json({ experiments: [] });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const arm = deterministicAssignment(String(body.assignmentKey ?? "demo"), [{ id: "control", trafficWeight: 50 }, { id: "variant", trafficWeight: 50 }]);
  return NextResponse.json({ ok: true, assignedArm: arm });
}
