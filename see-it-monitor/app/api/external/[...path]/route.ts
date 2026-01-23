import { NextRequest, NextResponse } from "next/server";

type RouteContext = {
  params: { path: string[] };
};

function jsonError(status: number, error: string, message: string): NextResponse {
  return NextResponse.json({ error, message }, { status });
}

function isSafePathSegment(segment: string): boolean {
  if (!segment) return false;
  if (segment === "." || segment === "..") return false;
  if (segment.includes("/") || segment.includes("\\")) return false;

  for (let i = 0; i < segment.length; i += 1) {
    const code = segment.charCodeAt(i);
    if (code <= 31 || code === 127) return false;
  }

  return true;
}

async function proxyToExternalApi(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const railwayUrl = process.env.RAILWAY_API_URL;
  const apiToken = process.env.MONITOR_API_TOKEN;

  // Security: Tokens NEVER exposed to client
  if (!railwayUrl) {
    return jsonError(500, "config_error", "RAILWAY_API_URL not configured");
  }
  if (!apiToken) {
    return jsonError(500, "config_error", "MONITOR_API_TOKEN not configured");
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(railwayUrl);
  } catch {
    return jsonError(500, "config_error", "RAILWAY_API_URL is not a valid URL");
  }
  if (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") {
    return jsonError(500, "config_error", "RAILWAY_API_URL must be http(s)");
  }

  const { path } = context.params;
  if (!Array.isArray(path) || path.length === 0 || path.length > 20) {
    return jsonError(400, "bad_request", "Invalid path");
  }
  if (!path.every(isSafePathSegment)) {
    return jsonError(400, "bad_request", "Invalid path");
  }

  const upstreamPath = path.join("/");
  if (upstreamPath.length > 2048) {
    return jsonError(414, "bad_request", "Path too long");
  }

  // Build upstream URL: ${RAILWAY_API_URL}/external/v1/<path>
  const upstreamUrl = new URL(`/external/v1/${upstreamPath}`, baseUrl);

  // Copy query params (except _reveal)
  const revealRequested = request.nextUrl.searchParams.get("_reveal") === "true";
  request.nextUrl.searchParams.forEach((value, key) => {
    if (key !== "_reveal") upstreamUrl.searchParams.append(key, value);
  });

  // Headers - tokens added server-side only
  const headers: HeadersInit = {
    Authorization: `Bearer ${apiToken}`,
    Accept: "application/json",
  };

  // Add reveal header if requested and configured
  if (revealRequested && process.env.MONITOR_REVEAL_TOKEN) {
    headers["X-Monitor-Reveal"] = process.env.MONITOR_REVEAL_TOKEN;
  }

  const method = request.method.toUpperCase();
  let body: ArrayBuffer | undefined;

  if (method !== "GET" && method !== "HEAD") {
    const contentType = request.headers.get("content-type");
    if (contentType) headers["Content-Type"] = contentType;

    const rawBody = await request.arrayBuffer();
    if (rawBody.byteLength > 0) body = rawBody;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl.toString(), {
      method,
      headers,
      body,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const responseHeaders = new Headers();
  const upstreamContentType = upstreamResponse.headers.get("content-type");
  if (upstreamContentType) responseHeaders.set("content-type", upstreamContentType);
  responseHeaders.set("cache-control", "no-store");

  return new NextResponse(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

function proxyError(error: unknown): NextResponse {
  console.error("Proxy error:", error);

  // Static message to avoid leaking internal details
  const message =
    error instanceof Error && error.name === "AbortError"
      ? "Upstream request timed out"
      : "Failed to reach Railway API";

  return jsonError(502, "proxy_error", message);
}

export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    return await proxyToExternalApi(request, context);
  } catch (error) {
    return proxyError(error);
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    return await proxyToExternalApi(request, context);
  } catch (error) {
    return proxyError(error);
  }
}
