import { NextRequest, NextResponse } from "next/server";
import { readEnv } from "@/lib/env";
import { createFounderSessionToken, isFounderPasswordValid } from "@/lib/founder/auth";

export async function POST(request: NextRequest) {
  const env = readEnv();
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/founder");
  if (!await isFounderPasswordValid(password, env)) {
    return NextResponse.json({ error: "invalid_founder_password" }, { status: 401 });
  }
  const response = NextResponse.redirect(new URL(next.startsWith("/") ? next : "/founder", request.url), { status: 303 });
  response.cookies.set("see_it_founder", await createFounderSessionToken(password, env.ENCRYPTION_KEY), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.APP_ENV !== "development" && env.APP_ENV !== "test",
    path: "/",
    maxAge: 60 * 60 * 8
  });
  return response;
}
