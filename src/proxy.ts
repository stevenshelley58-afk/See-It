import { NextRequest, NextResponse } from "next/server";
import { isFounderHeaderValid, isFounderSessionTokenValid } from "@/lib/founder/auth";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/founder/login" || pathname === "/api/founder/session") {
    return NextResponse.next();
  }
  const headerAllowed = await isFounderHeaderValid(request.headers.get("x-founder-password"));
  const cookieAllowed = await isFounderSessionTokenValid(request.cookies.get("see_it_founder")?.value);
  if (headerAllowed || cookieAllowed) {
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/founder")) {
    return NextResponse.json({ error: "founder_auth_required" }, { status: 401 });
  }
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/founder/login";
  loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/founder/:path*", "/api/founder/:path*"]
};
