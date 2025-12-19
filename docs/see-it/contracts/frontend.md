# Frontend Contracts

This file defines the high-level contracts between the frontend surfaces (theme extension + embedded admin) and the backend. It should almost never change. Any change here is a **material change** and requires a spec update.

If a proposed change conflicts with this file, STOP and ask for explicit approval to update the contract and `/docs/see-it/spec.md`.

## Theme app extension (storefront)

The PDP experience is delivered via a theme app extension block.

Core behaviors:

- Renders a “See it in your room” entry point on the PDP.
- Opens a modal/overlay flow that:
  - Starts a room session and obtains an upload URL.
  - Uploads the shopper’s room image directly to object storage.
  - Confirms the upload and allows the shopper to position a ghost overlay.
  - Creates a render job and polls its status until completion or failure.
- Saved Rooms feature:
  - Email capture is **hidden by default** and only shown when the shopper explicitly taps “Saved” or attempts to save a room.
  - The `shopper_token` (issued by `POST /apps/see-it/shopper/identify`) is stored client-side (localStorage) and sent with all Saved Rooms API requests.
  - Once an email is provided and token obtained, the email prompt remains hidden for subsequent sessions (until the token expires or is cleared).
- Communicates with the backend only via the app proxy routes defined in:
  - `/docs/see-it/spec.md` → Routes → Storefront app proxy routes
  - `/docs/see-it/contracts/backend.md` → App proxy routes

Rules:

- The theme extension MUST NOT introduce new backend routes or query parameters without updating the spec and backend contract.
- Polling for render status must be bounded (max ~60 seconds total); no unbounded intervals or hidden background polling.
- `room_session_id` and `job_id` must be treated as opaque identifiers; the frontend must not derive or rewrite them.
- `shopper_token` must be stored securely client-side and sent as `X-Shopper-Token` header (or `shopper_token` query param for GET requests). The token is opaque and must not be parsed or modified by the frontend.

## Embedded admin UI

The embedded admin UI is the only place merchants manage See It.

Core behaviors:

- Uses Shopify session tokens for all backend calls.
- Talks only to the Admin API routes defined in `/docs/see-it/spec.md` (Routes → Admin API).
- Drives `product_assets` and metafields configuration via documented endpoints.

Rules:

- The admin UI MUST NOT bypass backend validation, quota checks, or billing logic (no direct Shopify Admin GraphQL calls from the browser that assume server-side invariants).
- No direct calls to the image service from the browser.
- No hard-coded AI model names in frontend code; models must come from backend-provided configuration if they ever become visible.

