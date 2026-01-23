import { NextRequest, NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const railwayUrl = process.env.RAILWAY_API_URL;
  const apiToken = process.env.MONITOR_API_TOKEN;

  // Validate environment configuration
  if (!railwayUrl) {
    return NextResponse.json(
      { error: "config_error", message: "RAILWAY_API_URL not configured" },
      { status: 500 }
    );
  }

  if (!apiToken) {
    return NextResponse.json(
      { error: "config_error", message: "MONITOR_API_TOKEN not configured" },
      { status: 500 }
    );
  }

  try {
    // Build upstream URL: ${RAILWAY_API_URL}/external/v1/<path>
    const { path } = await context.params;
    const pathSegments = path.join("/");
    const upstreamUrl = new URL(`/external/v1/${pathSegments}`, railwayUrl);

    // Copy query params from request (except _reveal)
    const revealRequested =
      request.nextUrl.searchParams.get("_reveal") === "true";
    request.nextUrl.searchParams.forEach((value, key) => {
      if (key !== "_reveal") {
        upstreamUrl.searchParams.set(key, value);
      }
    });

    // Build headers - tokens added server-side only
    const headers: HeadersInit = {
      Authorization: `Bearer ${apiToken}`,
      Accept: "application/json",
    };

    // Add reveal header if requested and configured
    if (revealRequested && process.env.MONITOR_REVEAL_TOKEN) {
      headers["X-Monitor-Reveal"] = process.env.MONITOR_REVEAL_TOKEN;
    }

    // Proxy request to upstream
    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      method: "GET",
      headers,
    });

    // Parse response body
    let body: unknown;
    const contentType = upstreamResponse.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      body = await upstreamResponse.json();
    } else {
      body = await upstreamResponse.text();
    }

    // Return upstream response with same status
    return NextResponse.json(body, {
      status: upstreamResponse.status,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Proxy error:", error);

    // Return 502 Bad Gateway on proxy failure - static message to avoid leaking internal details
    return NextResponse.json(
      {
        error: "proxy_error",
        message: "Failed to reach Railway API",
      },
      { status: 502 }
    );
  }
}

// Support POST requests for future mutations
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const railwayUrl = process.env.RAILWAY_API_URL;
  const apiToken = process.env.MONITOR_API_TOKEN;

  if (!railwayUrl || !apiToken) {
    return NextResponse.json(
      { error: "config_error", message: "API configuration missing" },
      { status: 500 }
    );
  }

  try {
    const { path } = await context.params;
    const pathSegments = path.join("/");
    const upstreamUrl = new URL(`/external/v1/${pathSegments}`, railwayUrl);

    // Copy query params
    request.nextUrl.searchParams.forEach((value, key) => {
      if (key !== "_reveal") {
        upstreamUrl.searchParams.set(key, value);
      }
    });

    const headers: HeadersInit = {
      Authorization: `Bearer ${apiToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    const revealRequested =
      request.nextUrl.searchParams.get("_reveal") === "true";
    if (revealRequested && process.env.MONITOR_REVEAL_TOKEN) {
      headers["X-Monitor-Reveal"] = process.env.MONITOR_REVEAL_TOKEN;
    }

    const body = await request.text();

    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      method: "POST",
      headers,
      body: body || undefined,
    });

    let responseBody: unknown;
    const contentType = upstreamResponse.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      responseBody = await upstreamResponse.json();
    } else {
      responseBody = await upstreamResponse.text();
    }

    return NextResponse.json(responseBody, {
      status: upstreamResponse.status,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Proxy error:", error);
    // Static message to avoid leaking internal details
    return NextResponse.json(
      {
        error: "proxy_error",
        message: "Failed to reach Railway API",
      },
      { status: 502 }
    );
  }
}
