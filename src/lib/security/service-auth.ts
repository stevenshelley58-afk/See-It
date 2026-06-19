import type { NextRequest } from "next/server";
import { readEnv } from "@/lib/env";

export type ServiceAuth =
  | { ok: true }
  | { ok: false; status: number; error: string };

export function verifyServiceSecret(input: { authorization?: string | null; headerSecret?: string | null; querySecret?: string | null }, expectedSecret: string): ServiceAuth {
  const bearer = input.authorization?.startsWith("Bearer ") ? input.authorization.slice("Bearer ".length) : undefined;
  const provided = bearer ?? input.headerSecret ?? input.querySecret;
  if (!provided) {
    return { ok: false, status: 401, error: "service_auth_required" };
  }
  if (provided !== expectedSecret) {
    return { ok: false, status: 403, error: "invalid_service_secret" };
  }
  return { ok: true };
}

export function authenticateServiceRequest(request: NextRequest): ServiceAuth {
  return verifyServiceSecret({
    authorization: request.headers.get("authorization"),
    headerSecret: request.headers.get("x-cron-secret"),
    querySecret: request.nextUrl.searchParams.get("secret")
  }, readEnv().CRON_SECRET);
}

export function serviceAuthErrorBody(auth: Extract<ServiceAuth, { ok: false }>) {
  return { error: auth.error };
}
