# 01 — User Flows (Shopper + Merchant)

## Shopper flow (mobile)
1. Shopper taps the See It Now button on PDP.
2. Modal opens in `ENTRY` state (mobile only).
3. Shopper taps:
   - “Take photo” → opens camera capture, OR
   - “Upload a photo” → opens file picker.
4. When a file is selected:
   - Client normalizes image (see `03_THEME_EXTENSION.md`).
   - Client starts a room session: `POST /apps/see-it/room/upload`.
   - Client uploads to returned `upload_url` via HTTP PUT.
   - Client confirms upload (canonicalization): `POST /apps/see-it/room/confirm`.
   - Client requests variants: `POST /apps/see-it/see-it-now/render`.
5. Modal transitions:
   - `THINKING` during steps above.
   - `RESULT` when at least 1 variant image URL is returned.
6. Shopper swipes through variants.
7. Shopper taps “Share”:
   - Best-effort records selection: `POST /apps/see-it/see-it-now/select` with `upscale: true`.
   - Shares the final URL if returned; otherwise shares/downloads current variant.
8. Shopper taps “Try again” to restart, or closes modal.

## Shopper flow (desktop)
1. Shopper clicks See It Now button.
2. File picker opens immediately (modal can open after file selection if desired, but must end in `THINKING` while generating).
3. Steps 4–8 are identical to mobile.

## Modal finite-state machine (normative)
States:
- `CLOSED`
- `ENTRY` (mobile only)
- `THINKING`
- `RESULT`
- `ERROR`

Transitions:
- `CLOSED -> ENTRY` (mobile trigger click)
- `CLOSED -> (file-picker)` (desktop trigger click)
- `(file selected) -> THINKING`
- `THINKING -> RESULT` (variants length >= 1)
- `THINKING -> ERROR` (any handled failure)
- `RESULT -> THINKING` (Try again)
- `ERROR -> THINKING` (Try again)
- `ENTRY/THINKING/RESULT/ERROR -> CLOSED` (Close)

## Required edge-case behavior
- **User cancels file picker**: return to `CLOSED` (do not show error).
- **Upload PUT fails**: show `ERROR` with message “Upload failed. Please try again.” (exact wording may vary but must be user-friendly).
- **Confirm returns “not uploaded yet”**: retry confirm with backoff \(250ms, 750ms, 1500ms\), then fail to `ERROR`.
- **Render 403 `see_it_now_not_enabled`**: show `ERROR` stating feature not enabled.
- **Render 422**: show `ERROR` using backend-provided `message`.
- **Partial success variants**: display whatever variants are returned; never require exactly 5.

## Merchant flow (high-level)
1. Merchant installs app.
2. Merchant opens embedded admin UI.
3. Merchant goes to Products:
   - Enables See It Now for a product by ensuring it has a prepared cutout and is marked `live`.
   - Configures per-product See It Now prompt override and selected variants.
4. Merchant optionally configures shop-level See It Now prompt in Settings.
5. Merchant verifies block added to theme and sees storefront flow working.

