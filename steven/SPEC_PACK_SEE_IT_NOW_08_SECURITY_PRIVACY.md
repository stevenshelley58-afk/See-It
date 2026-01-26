# 08 — Security and Privacy

## Purpose
This document specifies security controls, authentication, authorization, data privacy, and attack prevention measures.

---

## Authentication

### Storefront (App Proxy)

All storefront routes use Shopify app proxy authentication:

```typescript
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { session } = await authenticate.public.appProxy(request);
  
  if (!session) {
    return json({ error: "forbidden" }, { status: 403 });
  }
  
  // session.shop is the authenticated shop domain
  const shopDomain = session.shop;
};
```

This validates the HMAC signature that Shopify includes in app proxy requests.

### Admin App

All admin routes use Shopify session authentication:

```typescript
export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  
  // session.shop is the authenticated shop domain
  // admin is the GraphQL client
};
```

---

## Authorization

### Tenant Isolation

**CRITICAL**: All database queries MUST be scoped to the authenticated shop.

```typescript
// CORRECT: Shop-scoped query
const asset = await prisma.productAsset.findFirst({
  where: {
    shopId: shop.id,        // Always include shop scope
    productId: productId
  }
});

// WRONG: Unscoped query (security vulnerability)
const asset = await prisma.productAsset.findFirst({
  where: { productId: productId }  // Missing shop scope!
});
```

### Shop Lookup Pattern

```typescript
// 1. Authenticate
const { session } = await authenticate.public.appProxy(request);

// 2. Get shop from database
const shop = await prisma.shop.findUnique({
  where: { shopDomain: session.shop }
});

if (!shop) {
  return json({ error: "shop_not_found" }, { status: 404 });
}

// 3. Use shop.id for all subsequent queries
const roomSession = await prisma.roomSession.findUnique({
  where: { id: roomSessionId },
  include: { shop: true }
});

// 4. Verify ownership
if (roomSession.shop.shopDomain !== session.shop) {
  return json({ error: "forbidden" }, { status: 403 });
}
```

### See It Now Allowlist

See It Now features are gated by shop allowlist:

```typescript
import { isSeeItNowAllowedShop } from "~/utils/see-it-now-allowlist.server";

if (!isSeeItNowAllowedShop(session.shop)) {
  return json({
    error: "see_it_now_not_enabled",
    message: "See It Now features are not enabled for this shop"
  }, { status: 403 });
}
```

Allowlist implementation:

```typescript
// Environment variable: comma-separated shop domains
const ALLOWED_SHOPS = (process.env.SEE_IT_NOW_ALLOWED_SHOPS || "")
  .split(",")
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

export function isSeeItNowAllowedShop(shopDomain: string): boolean {
  return ALLOWED_SHOPS.includes(shopDomain.toLowerCase());
}
```

---

## SSRF Prevention

**CRITICAL**: All server-side image fetches must validate URLs.

### Trusted URL Validation

```typescript
import { validateTrustedUrl } from "../utils/validate-shopify-url.server";

// Before any fetch:
validateTrustedUrl(url, "image URL");
// Throws Error if URL is not trusted

const response = await fetch(url);
```

### Trusted Domains

Only these domains are allowed for server-side fetches:

```typescript
const TRUSTED_DOMAINS = [
  "storage.googleapis.com",
  "storage.cloud.google.com",
  "cdn.shopify.com",
];

const TRUSTED_SUFFIXES = [
  ".storage.googleapis.com",
  ".storage.cloud.google.com",
  ".myshopify.com",
];
```

### Implementation

```typescript
export function validateTrustedUrl(url: string, context: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid ${context}: malformed URL`);
  }

  // Must be HTTPS
  if (parsed.protocol !== "https:") {
    throw new Error(`Invalid ${context}: must be HTTPS`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Check exact matches
  if (TRUSTED_DOMAINS.includes(hostname)) {
    return;
  }

  // Check suffix matches
  for (const suffix of TRUSTED_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      return;
    }
  }

  throw new Error(`Invalid ${context}: untrusted domain`);
}
```

---

## Rate Limiting

### Per-Session Rate Limiting

Prevents abuse of the render endpoint:

```typescript
const RATE_LIMIT_WINDOW_MS = 60 * 1000;  // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10;       // 10 requests per minute

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(sessionId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(sessionId);

  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(sessionId, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS
    });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;  // Rate limited
  }

  entry.count++;
  return true;
}
```

Rate limit response:

```typescript
if (!checkRateLimit(roomSessionId)) {
  return json({
    error: "rate_limit_exceeded",
    message: "Too many requests. Please wait a moment."
  }, { status: 429 });
}
```

---

## Input Validation

### Session ID Validation

```typescript
export function validateSessionId(sessionId: unknown): {
  valid: boolean;
  sanitized?: string;
  error?: string;
} {
  if (typeof sessionId !== "string") {
    return { valid: false, error: "Session ID must be a string" };
  }

  const trimmed = sessionId.trim();

  // UUID format check
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(trimmed)) {
    return { valid: false, error: "Invalid session ID format" };
  }

  return { valid: true, sanitized: trimmed.toLowerCase() };
}
```

### Content Type Validation

```typescript
const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
];

export function validateContentType(contentType: unknown): {
  valid: boolean;
  sanitized?: string;
  error?: string;
} {
  if (typeof contentType !== "string") {
    return { valid: false, error: "Content type must be a string" };
  }

  const normalized = contentType.toLowerCase().trim();

  if (!ALLOWED_CONTENT_TYPES.includes(normalized)) {
    return { valid: false, error: "Unsupported content type" };
  }

  // Normalize image/jpg to image/jpeg
  const sanitized = normalized === "image/jpg" ? "image/jpeg" : normalized;

  return { valid: true, sanitized };
}
```

### Variant ID Validation

```typescript
export function isSafeVariantId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const id = value.trim();
  if (!id) return false;
  if (id.length > 64) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id);
}
```

---

## Privacy Requirements

### No PII Storage

**CRITICAL**: The shopper flow must not store any personally identifiable information.

Prohibited:
- Email addresses (in shopper context)
- IP addresses
- Device identifiers
- Location data
- User accounts / login

Room sessions are:
- Anonymous (no user identifier)
- Ephemeral (expire in 24 hours)
- Shop-scoped (not cross-shop)

### Data Retention

| Data Type | Retention |
|-----------|-----------|
| Room sessions | 24 hours |
| Room images | 24 hours |
| Generated variants | 24 hours (tied to room session) |
| Render jobs | Indefinite (for analytics) |
| Product assets | Indefinite |

### GDPR Compliance

Webhook handlers for Shopify data requests:

```typescript
// webhooks.customers.data_request.jsx
// Return: No customer data stored

// webhooks.customers.redact.jsx
// Action: No customer data to redact

// webhooks.shop.redact.jsx
// Action: Delete all shop data (cascade delete from Shop model)
```

---

## Error Handling Security

### No Stack Traces to Client

```typescript
// WRONG: Exposes internal details
return json({ error: err.message, stack: err.stack }, { status: 500 });

// CORRECT: Generic error, log internally
logger.error({ err }, "Generation failed");
return json({
  error: "generation_failed",
  message: "Something went wrong. Please try again."
}, { status: 422 });
```

### Avoid HTML Error Responses

Shopify app proxy wraps 5xx responses in HTML. Always return JSON with 4xx for expected failures:

```typescript
// WRONG: 500 causes HTML wall
return json({ error: "failed" }, { status: 500 });

// CORRECT: 422 returns JSON
return json({
  error: "generation_failed",
  message: "Failed to generate visualization"
}, { status: 422 });
```

---

## CORS Security

CORS headers are shop-scoped:

```typescript
function getCorsHeaders(shopDomain: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  };

  if (shopDomain) {
    // Only allow requests from the authenticated shop's domain
    headers["Access-Control-Allow-Origin"] = `https://${shopDomain}`;
  }

  return headers;
}
```

---

## API Key Security

### Gemini API Key

- Stored in environment variable `GEMINI_API_KEY`
- Never exposed to client
- All AI calls are server-side

### GCS Credentials

- Stored in environment variables or service account file
- Never exposed to client
- Presigned URLs provide temporary, scoped access

---

## Checklist

Security verification checklist for code review:

- [ ] All database queries include shop scope
- [ ] All server-side fetches use validateTrustedUrl
- [ ] No PII stored in room sessions
- [ ] Rate limiting applied to render endpoints
- [ ] Input validation on all user-provided data
- [ ] Error responses don't expose internals
- [ ] CORS headers are shop-specific
- [ ] See It Now allowlist checked before features
- [ ] No 5xx responses for expected failures
