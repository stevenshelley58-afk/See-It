# Backend Contracts

This file locks the backend-facing contracts and must change **very rarely**. Any change here is automatically a **material change** and MUST be accompanied by:

- A spec update in `/docs/see-it/spec.md` (with version bump and changelog entry).
- Matching updates to code and tests.

If a proposed change conflicts with this file, STOP and ask for explicit approval to update the contract and spec.

## App proxy routes (customer facing)

Shopify external paths hit by the theme extension:

```text
POST /apps/see-it/room/upload
POST /apps/see-it/room/confirm
POST /apps/see-it/render
GET  /apps/see-it/product/prepared
GET  /apps/see-it/render/:jobId
POST /apps/see-it/shopper/identify
GET  /apps/see-it/rooms
POST /apps/see-it/rooms/save
POST /apps/see-it/rooms/delete
```

Rules:

- These routes and HTTP methods MUST remain exactly as written unless `/docs/see-it/spec.md` and this file are updated first.
- No new customer-facing app proxy routes without updating this file and the spec.
- Request/response payloads must remain compatible with the contracts described in the “Routes” section of `/docs/see-it/spec.md`.

Implementation detail:

- Internally, these external paths are handled by Remix routes under `app/app/routes/app-proxy.*`. The internal file names may change, but the *external* contract above is the stable surface.

## Admin API contracts (embedded admin)

Core internal endpoints:

- `GET /api/products` — list products with See It status.
- `GET /api/products/:id/assets` — list `product_assets` for a product.
- `POST /api/products/:id/prepare` — trigger prep for selected Shopify image IDs.
- `POST /api/products/batch-prepare` — batch prepare multiple products (typically using featured images).
- `POST /api/products/:id/assets/:assetId/default` — set the default prepared asset (metafield).
- `GET /api/settings` / `POST /api/settings` — read and write See It admin settings.

Rules:

- These endpoints SHOULD remain stable; any breaking change (renaming, removing, or changing payload shapes) requires a spec + contract update.
- Adding new admin endpoints is allowed, but they must be documented in `/docs/see-it/spec.md` under Routes → Admin API.

## Image service contracts

Backend ↔ image service endpoints:

- `POST /product/prepare`
- `POST /scene/composite`

Rules:

- These endpoints are *internal only*; they must not be directly callable from the storefront or theme extension.
- They must always return URLs, never raw image binaries.
- Their request/response shapes must follow `/docs/see-it/spec.md` (Routes → Image service routes).

## Auth and security rules

- All app proxy requests must validate the Shopify HMAC signature and shop identity before doing any work.
- Saved Rooms endpoints (`GET /apps/see-it/rooms`, `POST /apps/see-it/rooms/save`, `POST /apps/see-it/rooms/delete`) additionally require a `shopper_token` (issued by `POST /apps/see-it/shopper/identify`) for ownership verification. The token must be validated server-side and must match the shop context.
- All admin endpoints must validate Shopify session tokens and ensure tenant isolation by `shop_id`.
- No changes to auth logic, HMAC validation, or multi-tenant isolation are allowed without updating:
  - This contract file
  - `/docs/see-it/spec.md` (Non negotiables + Routes)
  - Any relevant deployment/docs that describe auth behavior

