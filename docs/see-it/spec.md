# See It App Spec
Version: 0.5
Last updated: 2026-02-15
Status: In use

> If it is not in this file, it is not real. All meaningful behavior, routes, schema, and contracts for the See It app MUST be described here. Code and other docs must follow this spec, not the other way around.

## Purpose

See It is a Shopify app that lets shoppers preview a product inside their own room photos, directly from the product detail page (PDP), while giving merchants a stable way to prepare, manage, and track the assets and usage behind those renders.

This spec defines the single source of truth for:

- Shopper and merchant flows
- Backend and image-service contracts
- Database schema and key invariants
- Non-negotiable architectural constraints
- Change-management rules for future work

## High-level user flows

### Shopper flows (PDP, storefront)

- Shopper clicks “See it in your room” on a product page and opens a modal or overlay without leaving the PDP.
- Shopper uploads a room photo (or captures one in future phases) and sees it acknowledged by the system.
- Shopper positions a ghost overlay of the product on top of the room image, then clicks a button to request a render.
- Shopper waits while the app creates a render job and calls the image service; once complete, the rendered composite appears in the modal.
- Shopper can optionally adjust placement, try again, or close the experience; advanced editing tools (cleanup, rotation, etc.) are later phases.

### Merchant flows (Shopify admin)

- Merchant installs the app via OAuth; the app creates a shop record, registers webhooks, and guides the merchant through initial setup.
- Merchant configures which products use See It (via metafields / settings) and adds the theme extension block to the PDP.
- Merchant views available product images, triggers preparation into transparent PNGs, and can regenerate or change the default prepared asset.
- Merchant configures See It defaults (style presets, automation, optional quotas display) and reviews usage metrics in the admin.

### Out of scope (for current phase)

The following are explicitly *out of scope* until this section is updated:

- Room cleanup tooling (mask-based erase and re-inpainting) beyond a simple stub that can return the original image URL.
- Advanced placement controls such as rotation, multi-point perspective, or complex drag semantics beyond basic position and scale.
- Batch preparation automation, stale-asset detection/cleanup, billing integration, quota enforcement per plan, and rich analytics.
- Any “temporary” architecture that bypasses the image service or object storage (e.g., storing binaries in the DB, direct Gemini calls from the frontend).

## Architecture summary

### Components

- **Shopify App (backend + admin UI)**  
  Node/TypeScript service based on the Shopify React Router app template. Owns OAuth, sessions, Admin GraphQL, webhooks, billing, app proxy routes, quota enforcement, and the embedded admin UI.

- **Theme App Extension (storefront widget)**  
  Renders the See It block on the PDP, manages the shopper modal flow, and talks to the app exclusively via JSON app proxy endpoints and presigned upload URLs.

- **Image Service (AI backend)**  
  Stateless HTTP service (e.g., Cloud Run) that wraps Gemini image models. Exposes stable endpoints for product asset preparation, room cleanup (future), and scene compositing, always returning image URLs (never raw binaries).

- **Object Storage**  
  GCS/S3/R2 buckets with per-shop prefixes. All room captures, prepared assets, masks, and composites are stored here and referenced by URL from the database.

### Storage layout (logical)

Object storage keys are logically organized as:

```text
room-original/{shop_id}/{room_session_id}/{uuid}.jpg
room-cleaned/{shop_id}/{room_session_id}/{uuid}.jpg
product-prepared/{shop_id}/{product_id}/{asset_id}.png
composites/{shop_id}/{render_job_id}.jpg
saved-rooms/{shop_id}/{saved_room_id}/original.jpg
saved-rooms/{shop_id}/{saved_room_id}/cleaned.jpg
```

Retention expectations:

- Room originals: ~24 hours
- Room cleaned variants: ~24–72 hours
- Composites: ~30 days
- Prepared product assets: indefinite until uninstall/cleanup
- Saved rooms: indefinite until explicitly deleted by shopper or shop cleanup

### Security and limits

- All storefront-facing endpoints use Shopify app proxy HMAC validation and must reject unauthenticated requests.
- Rate limiting is enforced per `room_session_id` (and per shop) to prevent quota-draining attacks (e.g., max 5 render attempts per minute).
- Internal image service endpoints are authenticated via internal credentials (e.g., shared secret or service account) and *never* exposed to the storefront.

## Routes

This section is normative for all HTTP contracts. Any change to these routes or payloads is considered a **material change** and MUST:

1. Be updated here in `/docs/see-it/spec.md`.
2. Update the relevant contract file(s) under `/docs/see-it/contracts`.
3. Include migration or rollout notes where applicable.

### Storefront app proxy routes (external, customer-facing)

External Shopify proxy paths (what the theme extension calls):

- `POST /apps/see-it/room/upload`  
  Starts a new room session and returns:
  - `room_session_id` (UUID, opaque to the client)
  - `upload_url` (presigned storage URL)
  - `room_image_future_url` (expected final storage location)
  - Note: Internal route file may be named `room.start`, but the canonical external path is `/apps/see-it/room/upload`.

- `POST /apps/see-it/room/mask-start`  
  Creates a presigned upload for an optional room mask image tied to an existing `room_session_id`. Returns:
  - `upload_url` (presigned storage URL)
  - `mask_image_url` (public URL where the mask will be stored)

- `POST /apps/see-it/room/confirm`  
  Confirms that the room image has been uploaded to storage, binding it to the `room_session_id`. Returns `{ "ok": true }` on success.

- `POST /apps/see-it/room/cleanup` *(stub for now)*  
  Reserved for future room cleanup tools. For MVP this may simply echo back the original room image URL or a no-op cleaned URL.

- `GET /apps/see-it/product/prepared?product_id={gid}`  
  Returns the most recent prepared asset for the given product (if any):
  - `prepared_image_url` (string | null)
  - `source_image_url` (string | null)
  - `status` (`ready | pending | failed | not_found`)
  - Includes CORS headers for storefront access.

- `POST /apps/see-it/render`  
  Creates a render job:
  - Input: product and variant identifiers, `room_session_id`, placement (`x`, `y`, `scale`), and a small config object (e.g., `style_preset`, `quality`).
  - Output: `{ "job_id": "uuid" }`.

- `GET /apps/see-it/render/:jobId`  
  Polls the status of the render job:
  - `status`: `queued | processing | completed | failed`
  - `image_url` when `completed`
  - `error_code` / `error_message` when `failed`

- `POST /apps/see-it/shopper/identify`  
  Associates a shopper email with the current shop session for Saved Rooms functionality:
  - Input: `{ email }` (string, validated email format)
  - Output: `{ shopper_token }` (JWT-like token, scoped to shop + email, stored client-side)
  - Behavior: validates email format, lowercases it, creates or finds a `SavedRoomOwner` record, issues a signed token for subsequent requests. The token is opaque to the client and must be sent as `X-Shopper-Token` header or `shopper_token` query param.

- `GET /apps/see-it/rooms`  
  Lists saved rooms for the authenticated shopper:
  - Auth: requires `shopper_token` (via header `X-Shopper-Token` or query param `shopper_token`)
  - Output: `{ rooms: [{ id, title, preview_url, created_at }] }` where `preview_url` is a short-lived signed URL (1 hour TTL)

- `POST /apps/see-it/rooms/save`  
  Saves a room session as a persistent saved room:
  - Auth: requires `shopper_token`
  - Input: `{ room_session_id, title? }` (optional title for the saved room)
  - Output: `{ saved_room_id, preview_url }`
  - Behavior: copies room image file(s) from the session's GCS key(s) into the `saved-rooms/{shop_id}/{saved_room_id}/` prefix. Creates a `SavedRoom` DB record linked to the `SavedRoomOwner`. The original session can still expire/be deleted; saved rooms are independent.

- `POST /apps/see-it/rooms/delete`  
  Deletes a saved room:
  - Auth: requires `shopper_token`
  - Input: `{ saved_room_id }`
  - Output: `{ ok: true }`
  - Behavior: verifies ownership, deletes the `SavedRoom` DB record, and deletes associated GCS files.

Implementation detail (current template): these external paths are handled via Remix routes under `app/app/routes/app-proxy.*` but the **contract** above is what must remain stable.

### Admin API routes (embedded admin, internal)

Auth: Shopify session tokens from the embedded admin. Shapes should stay as stable as possible; breaking changes require spec and contract updates.

- `GET /api/products`  
  Returns a paginated list of products and their See It status (enabled/disabled, number of prepared assets, basic usage).

- `GET /api/products/:id/assets`  
  Lists `product_assets` for a given Shopify product, including status and prepared image URLs.

- `POST /api/products/:id/prepare`  
  Triggers preparation for one or more selected Shopify image IDs for the product. Creates/updates `product_assets` rows and kicks off image service calls.

- `POST /api/products/batch-prepare`  
  Triggers preparation for a batch of product IDs (typically using each product’s featured image). Applies quota checks and returns per-item success/failure details.

- `POST /api/products/:id/assets/:assetId/default`  
  Marks a prepared asset as the default for the product, updating the relevant metafield(s).

- `GET /api/settings` / `POST /api/settings`  
  Reads and updates See It configuration (style presets, automation flags, and optional quota/usage preferences).

### Image service routes (backend ⇄ image service)

Auth: internal only. All endpoints accept and return JSON, and always return URLs, **never** binary blobs.

- `POST /product/prepare`  
  - Input: `source_image_url`, `shop_id`, `product_id`, `asset_id`, and a `prompt` + `model` descriptor.  
  - Output: `{ "prepared_image_url": "https://bucket/product-prepared/{...}.png" }` (transparent PNG containing only the product).

- `POST /room/cleanup` *(future)*  
  - Input: `room_image_url`, `mask_url`, and prompt/model descriptors.  
  - Output: `{ "cleaned_room_image_url": "https://bucket/room-cleaned/{...}.jpg" }`.

- `POST /scene/composite`  
  - Input: `prepared_product_image_url`, `room_image_url` (original or cleaned), placement (`x`, `y`, `scale`), and prompt/model descriptors.  
  - Output: `{ "image_url": "https://bucket/composites/{render_job_id}.jpg" }`.

## Database schema (canonical)

The relational schema is implemented via Prisma at `app/prisma/schema.prisma`. The tables below are **canonical**. New tables, columns, or type changes MUST be reflected here and documented under “Non negotiables” / migration notes.

### `shops`

Represents an installed Shopify shop.

- `id` (uuid, pk)
- `shop_domain` (text, unique, not null)
- `shopify_shop_id` (text, not null)
- `access_token` (text, not null)
- `plan` (text, not null) — e.g. `"free"`, `"pro"`, `"enterprise"`.
- `monthly_quota` (integer, not null)
- `daily_quota` (integer, not null)
- `created_at` (timestamptz, not null, default now)
- `uninstalled_at` (timestamptz, null)

Relationships:

- 1 → many `product_assets`
- 1 → many `room_sessions`
- 1 → many `render_jobs`
- 1 → many `usage_daily`
- 1 → many `saved_room_owners`

### `product_assets`

Prepared product imagery scoped to a shop + product + source image.

- `id` (uuid, pk)
- `shop_id` (uuid, fk → `shops.id`)
- `product_id` (text, not null) — Shopify GID
- `variant_id` (text, null) — Shopify GID
- `source_image_id` (text, not null) — Shopify image ID/GID
- `source_image_url` (text, not null)
- `prepared_image_url` (text, null) — transparent PNG URL
- `status` (text, not null) — `pending | ready | failed | stale | orphaned`
- `prep_strategy` (text, not null) — `batch | fallback | manual`
- `prompt_version` (integer, not null)
- `error_message` (text, null) — optional failure context
- `created_at` (timestamptz, not null)
- `updated_at` (timestamptz, not null)

Constraints & relationships:

- Index on `(shop_id, product_id)`
- Many → 1 `shop`
- 1 → many `render_jobs`

### `room_sessions`

Tracks a shopper’s room-upload session.

- `id` (uuid, pk) — `room_session_id`
- `shop_id` (uuid, fk → `shops.id`)
- `original_room_image_url` (text, null) — legacy signed URL (deprecated in favor of key-based URLs)
- `cleaned_room_image_url` (text, null) — legacy signed URL (deprecated in favor of key-based URLs)
- `original_room_image_key` (text, null) — GCS key for the original room image (stable reference)
- `cleaned_room_image_key` (text, null) — GCS key for cleaned variant (stable reference)
- `gemini_file_uri` (text, null) — optional URI for Gemini file uploads
- `created_at` (timestamptz, not null)
- `expires_at` (timestamptz, not null)
- `last_used_at` (timestamptz, null)

Relationships:

- Many → 1 `shop`
- 1 → many `render_jobs`

### `render_jobs`

Represents a single composite render attempt.

- `id` (uuid, pk)
- `shop_id` (uuid, fk → `shops.id`)
- `product_id` (text, not null)
- `variant_id` (text, null)
- `product_asset_id` (uuid, fk → `product_assets.id`)
- `room_session_id` (uuid, fk → `room_sessions.id`)
- `placement_x` (double precision, not null)
- `placement_y` (double precision, not null)
- `placement_scale` (double precision, not null)
- `style_preset` (text, null)
- `quality` (text, null)
- `config_json` (jsonb, null) — serialized `config` payload
- `status` (text, not null) — `queued | processing | completed | failed`
- `image_url` (text, null)
- `model_id` (text, null)
- `prompt_id` (text, null)
- `prompt_version` (integer, null)
- `error_code` (text, null)
- `error_message` (text, null)
- `created_at` (timestamptz, not null)
- `completed_at` (timestamptz, null)

Relationships:

- Many → 1 `shop`
- Many → 1 `product_asset`
- Many → 1 `room_session`

### `usage_daily`

Aggregated per-day usage per shop.

- `id` (uuid, pk)
- `shop_id` (uuid, fk → `shops.id`)
- `date` (date, not null)
- `prep_renders` (integer, not null, default 0)
- `cleanup_renders` (integer, not null, default 0)
- `composite_renders` (integer, not null, default 0)

Constraints:

- Unique `(shop_id, date)`
- Many → 1 `shop`

### `saved_room_owners`

Represents a shopper who has saved rooms, identified by email address.

- `id` (uuid, pk)
- `shop_id` (uuid, fk → `shops.id`)
- `email` (text, not null) — lowercased email address
- `created_at` (timestamptz, not null, default now)

Constraints & relationships:

- Unique `(shop_id, email)` — one owner record per shop+email combination
- Many → 1 `shop`
- 1 → many `saved_rooms`

### `saved_rooms`

Persistent saved room images that shoppers can reuse across sessions.

- `id` (uuid, pk)
- `shop_id` (uuid, fk → `shops.id`)
- `owner_id` (uuid, fk → `saved_room_owners.id`)
- `title` (text, null) — optional user-provided title
- `original_image_key` (text, not null) — GCS key for the original room image (e.g., `saved-rooms/{shop_id}/{id}/original.jpg`)
- `cleaned_image_key` (text, null) — optional GCS key for cleaned variant
- `created_at` (timestamptz, not null, default now)
- `updated_at` (timestamptz, not null, updated on save)

Constraints & relationships:

- Many → 1 `shop`
- Many → 1 `saved_room_owner`
- Index on `(shop_id, owner_id)` for efficient listing

Note: Saved rooms are independent of `room_sessions`. When a room is saved, the image files are copied from the session's temporary storage into the persistent `saved-rooms/` prefix. The original session can still expire and be cleaned up; saved rooms persist until explicitly deleted.

### Shopify metafields (product level)

Namespace: `see_it`

- `enabled` (boolean) — toggles See It per product.
- `default_asset_id` (string) — stores `product_assets.id` used by default on the storefront.
- `style_preset` (string, optional) — overrides the default style preset for the product.

## Non negotiables

These rules are *hard* constraints. Any proposed change that conflicts with them MUST either be rejected or explicitly approved by updating this section first.

1. **Route shapes**
   - Do not rename or change the HTTP methods of the shopper-facing app proxy routes (`/apps/see-it/...`) without updating this spec and the backend contract file first.
   - No new app proxy routes without updating `/docs/see-it/spec.md` and `/docs/see-it/contracts/backend.md`.

2. **DB schema**
   - No new Prisma models without a written purpose, columns, and relationships documented in this spec.
   - No field type changes or column renames without explicit migration notes added here.
   - Image binaries MUST remain in object storage; the DB only stores URLs and metadata.

3. **Third-party stack**
   - Core stack is Shopify + Prisma + object storage (GCS/S3/R2) + Gemini-backed image service.
   - Do not replace Gemini, Prisma, or object storage with alternative services without updating this section and the relevant contracts.

4. **Timeouts and polling**
   - Frontend polling for render status must have bounded retries (max ~60 seconds wall-clock).
   - No unbounded loops or background polling that can silently exhaust quotas.

5. **Contracts**
   - The contract files under `/docs/see-it/contracts` (frontend, backend, db) are normative and should almost never change.
   - Any change to those files is automatically a “material change” and must be treated as such (see “Change process”).

If any plan, code change, or refactor conflicts with this section, work must STOP and the spec must be explicitly updated (with version bump and changelog entry) before proceeding.

## Change process

Any **material change** to the app (routes, payloads, schema, auth behavior, major flows, or contracts) MUST:

1. **Start with this spec**
   - Update `/docs/see-it/spec.md` to describe the intended new behavior.
   - Ensure the change is consistent with “Non negotiables” or explicitly update that section.
2. **Update contracts**
   - Update the relevant contract file(s) under `/docs/see-it/contracts` to match.
3. **Bump the version**
   - Increment the `Version:` field above (e.g., `0.3` → `0.4`).
4. **Log the change**
   - Add a one-line entry to the changelog below summarizing the change and its impact.
5. **Then change code**
   - Only after the spec and contracts are updated should code changes be implemented.

## Changelog

- **0.5 — 2026-02-15**  
  Added Saved Rooms feature with email-gated shopper identity. New app-proxy routes: `POST /apps/see-it/shopper/identify`, `GET /apps/see-it/rooms`, `POST /apps/see-it/rooms/save`, `POST /apps/see-it/rooms/delete`. New DB tables: `saved_room_owners` and `saved_rooms` for persistent room storage independent of temporary sessions. Storage layout extended with `saved-rooms/` prefix. Room sessions schema extended with `original_room_image_key` and `cleaned_room_image_key` fields for stable GCS references.

- **0.4 — 2026-02-15**  
  Documented existing mask upload helper, prepared-asset fetch endpoint, and admin batch prepare route; added room session `gemini_file_uri` and product asset `error_message` fields to the canonical schema; clarified canonical room upload path.

- **0.3 — 2025-12-07**  
  Consolidated prior See It specs into a single `/docs/see-it/spec.md` file, added Non negotiables and contract references, and introduced a spec-first change process for all future work.

