# 00 — Product Scope (See It Now)

## Purpose
Enable a shopper on a Shopify Product Detail Page (PDP) to upload a room photo and receive multiple AI-generated “hero shot” variants showing the product placed into their room. The shopper swipes variants and can share/download.

## Hard constraints (must not change)
- **Storefront communicates with backend only via Shopify App Proxy routes** under `POST/GET /apps/see-it/...` (no direct backend URLs from storefront JS).
- **All image generation happens server-side** (no Gemini calls from the browser).
- **No external assets** on storefront: no Google Fonts, no third-party CDNs, no remote script tags.
- **Expected failures must return JSON with 4xx/422** (avoid Shopify proxy “HTML wall” on 5xx responses).
- **AI model names are locked** and must be sourced from centralized config constants (see `04_BACKEND_APP_PROXY_API.md`).
- **No shopper PII persistence** (no email capture, no saved rooms, no identifying tokens).

## In scope (MVP)
### Storefront (theme extension)
- PDP block renders “See it in your home” entry point.
- Modal flow:
  - Mobile: Entry screen → camera or upload
  - Desktop: file picker immediately
  - Thinking screen while generating
  - Results screen: swipe carousel + dots + share/download
  - Error screen with retry
- Client-side room photo normalization (crop to supported ratios, max dimension, JPEG encode).

### Backend (Shopify app)
- Shopify embedded admin app for merchant configuration.
- App proxy routes:
  - `POST /apps/see-it/room/upload`
  - `POST /apps/see-it/room/confirm`
  - `POST /apps/see-it/see-it-now/render`
  - `POST /apps/see-it/see-it-now/select`
- Quota enforcement + rate limiting (per shop and per room session).
- SSRF defenses for any server-side fetch.

### Database + Storage
- Postgres schema for shops/product assets/room sessions/render jobs/usage.
- GCS keys for:
  - room uploads
  - canonical room images
  - generated variants
  - prepared product cutouts

## Out of scope (explicit)
- Saved rooms
- Email capture / shopper identity
- Manual drag/scale placement
- Mask editing / cleanup / inpainting UI
- Billing plans (unless added later by expanding this spec)
- Any additional app proxy routes beyond those in scope

## Terminology
- **Shopper**: storefront user.
- **Merchant**: Shopify admin user.
- **PDP**: product detail page.
- **RoomSession**: one upload session for one shopper room photo.
- **Variant**: one generated hero-shot composite image.
- **ProductAsset**: the prepared product cutout + prompts/config for a product in a given shop.

## Success metrics (targets)
- Time to first result: 8–20s typical, 60s max timeout handling.
- Flow completion rate (photo selected → results): > 80% (with reasonable network).
- No unexpected HTML error pages in the modal (all handled failures are JSON).

