---
name: PhotoRoom product-prep migration
overview: Migrate all product background removal/prep to PhotoRoom with deterministic alpha-trim, strict PNG invariants, feature-flag rollback, and production safety controls (timeouts/retries/backoff/concurrency/per-shop throttling), plus minimal docs + golden test harness.
todos:
  - id: db-fields
    content: Add prepared image version+timestamp fields to ProductAsset + migration.
    status: pending
  - id: photoroom-client
    content: Implement PhotoRoom v2 client with timeout/retry/backoff/typed errors.
    status: pending
  - id: trim-alpha
    content: Implement deterministic alpha-based PNG trim util and replace sharp.trim usage.
    status: pending
  - id: product-prep
    content: Implement prepareProductImage pipeline with concurrency+per-shop throttling and PNG invariants.
    status: pending
  - id: wire-batch
    content: Refactor gemini.prepareProduct + prepare-processor to use product-prep, add precedence rules.
    status: pending
  - id: wire-manual
    content: Update manual remove-background/apply-mask routes with feature flags and dual edge assist.
    status: pending
  - id: select-prepared
    content: Add selectPreparedImage() and update render/UI call sites to use it.
    status: pending
  - id: docs-and-tests
    content: Add MIGRATION.md + env.example updates + golden test harness; update existing test harness; perform @imgly cleanup after tests pass.
    status: pending
isProject: false
---

### Goals (non-negotiables wired into code)

- **Always trim by alpha bounds in our code** after any cutout output (never trust provider cropping).
- **Prepared outputs are always**: PNG + alpha + `contentType=image/png` + correct PNG magic bytes.
- **Single source-of-truth** for which prepared image is used (UI preview + rendering).
- **Keep Prodia** for apply-mask edge assist fallback behind feature flags.
- **Operational controls**: timeout, retries, backoff on 429, global concurrency cap, per-shop throttling.
- **Golden test harness** that exercises sample images and checks invariants.

### 0) Key codepaths discovered (current state)

- Batch prep uses `prepareProduct()` in [`app/app/services/gemini.server.ts`](app/app/services/gemini.server.ts), which currently uses `@imgly/background-removal-node` and also trims internally.
- Manual remove background: [`app/app/routes/api.products.remove-background.jsx`](app/app/routes/api.products.remove-background.jsx) uses Prodia + `sharp.trim()`.
- Manual apply mask: [`app/app/routes/api.products.apply-mask.jsx`](app/app/routes/api.products.apply-mask.jsx) uses Prodia for edges (optional) + `sharp.trim()`.
- Rendering/product selection logic is duplicated in:
- [`app/app/routes/app-proxy.see-it-now.render.ts`](app/app/routes/app-proxy.see-it-now.render.ts)
- [`app/app/routes/app-proxy.see-it-now.stream.ts`](app/app/routes/app-proxy.see-it-now.stream.ts)
- [`app/app/routes/app-proxy.product.prepared.ts`](app/app/routes/app-proxy.product.prepared.ts)
- UI loader in [`app/app/routes/app.products.jsx`](app/app/routes/app.products.jsx)
- PNG magic bytes validation is implemented in [`app/app/services/gemini-files.server.ts`](app/app/services/gemini-files.server.ts) (`validateMagicBytes`).

### 1) Add DB fields needed for manual-vs-batch precedence (required by spec)

Update [`app/prisma/schema.prisma`](app/prisma/schema.prisma) `ProductAsset` to add:

- `preparedProductImageVersion Int @default(0) @map("prepared_product_image_version")`
- `preparedProductImageUpdatedAt DateTime? @map("prepared_product_image_updated_at")`

Then generate a Prisma migration so production can enforce:

- Manual routes increment `preparedProductImageVersion` and set `preparedProductImageUpdatedAt=now()`.
- Batch processor writes prepared output only if there is **no newer manual update since the batch attempt began**.

### 2) Create PhotoRoom v2 client

Create [`app/app/services/photoroom.server.ts`](app/app/services/photoroom.server.ts):

- `photoroomRemoveBackground({ buffer, contentType, requestId, mode })` using **POST `https://image-api.photoroom.com/v2/edit`** (docs show `export.format=png`, `outputSize=originalImage`).
- Enforce **input <= 30MB**, timeout via `AbortController` using `PHOTOROOM_TIMEOUT_MS`.
- Retry up to `PHOTOROOM_RETRY_MAX` with **429 exponential backoff + jitter** and **do not exceed the total timeout budget**.
- Force/verify **PNG output**:
- request: `export.format=png`, `Accept: image/png, application/json`
- verify: `validateMagicBytes(..., "image/png")`; if non-PNG, convert to PNG via `sharp(...).png({ force:true })` then re-validate.
- Support HD mode: when `mode === "hd_auto"`, send header `pr-hd-background-removal: auto`.
- Log only safe fields (never API key): `requestId`, durationMs, status, retries, response size.
- Throw typed errors: `PhotoRoomTimeoutError`, `PhotoRoomRateLimitError`, `PhotoRoomBadResponseError`.

### 3) Deterministic alpha-trim implementation (single implementation used everywhere)

Create [`app/app/services/image-prep/trim-alpha.server.ts`](app/app/services/image-prep/trim-alpha.server.ts):

- `trimTransparentPaddingPng(pngBuffer)`:
- Decode PNG, require **real alpha channel** (`sharp(metadata).hasAlpha === true`) else throw `TrimAlphaError`.
- Scan alpha with threshold **alpha > 1** to find bounds.
- If fully transparent → throw `TrimAlphaError`.
- Re-encode tightly-cropped PNG (no resizing), using fixed PNG encoder options for determinism.

### 4) Single product-prep pipeline used by batch + manual remove-background

Create [`app/app/services/image-prep/product-prep.server.ts`](app/app/services/image-prep/product-prep.server.ts):

- Export `prepareProductImage({ sourceBuffer, sourceContentType, requestId, shopId?, productAssetId?, strategy })`.
- Pipeline:
- **Normalize** (sharp): `.rotate()` EXIF, resize max 2048, convert to PNG.
- **Cutout**: call `photoroomRemoveBackground` (use `outputSize=originalImage` to keep alignment).
- **Trim**: always call `trimTransparentPaddingPng`.
- **Validate**: `validateMagicBytes(preparedPng, "image/png")` and assert alpha presence.
- Add **operational controls here** (so all call sites get them):
- Global concurrency cap via `PHOTOROOM_CONCURRENCY_MAX` (semaphore).
- Per-shop throttling: in-memory lock + Postgres advisory lock (when running on Postgres) so only **1 in-flight PhotoRoom prep per shop**.

### 5) Replace @imgly usage in batch prep (and keep trim exactly once)

Modify [`app/app/services/gemini.server.ts`](app/app/services/gemini.server.ts):

- Remove `@imgly/background-removal-node` import and all imgly background-removal/trim code.
- Update `prepareProduct()` to:
- download source to buffer (and capture source content-type)
- call `prepareProductImage()`
- upload resulting `preparedPng` to GCS with `contentType: "image/png"`
- keep existing Gemini Files pre-upload, but ensure it uses `image/png`
- Ensure trimming happens **only** inside `product-prep.server.ts`.

### 6) Manual remove background route with rollback flag

Modify [`app/app/routes/api.products.remove-background.jsx`](app/app/routes/api.products.remove-background.jsx):

- Add feature flag:
- if `process.env.IMAGE_PREP_PROVIDER !== "photoroom"` → keep legacy Prodia path (rollback).
- else → fetch/source buffer + call `prepareProductImage({ strategy: "manual_remove_bg" })`.
- Upload prepared PNG to GCS with `image/png`.
- Update `ProductAsset`:
- always overwrite `preparedImageKey`
- bump `preparedProductImageVersion += 1`
- set `preparedProductImageUpdatedAt = now`
- Response on success must be exactly:
- `{ success: true, preparedImageUrl, processingTimeMs }`

### 7) Manual apply-mask route with dual-mode edge assist (photoroom/prodia/off)

Modify [`app/app/routes/api.products.apply-mask.jsx`](app/app/routes/api.products.apply-mask.jsx):

- Add env flags:
- `IMAGE_EDGE_ASSIST_PROVIDER = photoroom|prodia|off` (default photoroom)
- `IMAGE_PREP_PROVIDER = photoroom|legacy` (default photoroom)
- Behavior:
- **off**: apply user mask directly, then `trimTransparentPaddingPng`, validate PNG+alpha.
- **prodia**: keep existing Prodia edge path to get `aiAlpha`.
- **photoroom**:
- run PhotoRoom cutout on the **normalized (untrimmed) image** so the alpha mask aligns to source dimensions (use `/v2/edit` with `outputSize=originalImage`, do NOT trim before extracting alpha).
- extract alpha mask from that untrimmed cutout.
- Intersect: `finalAlpha = aiAlpha AND userAlphaExpanded` (existing logic).
- Composite back onto transparent canvas at original dimensions.
- THEN `trimTransparentPaddingPng` once at the end.
- Upload with `image/png`, update version/timestamp (manual).
- Keep response JSON shape consistent with current UI expectations:
- `{ success: true, preparedImageUrl, processingTimeMs }`

### 8) Batch processor production safety + manual/batch precedence

Modify [`app/app/services/prepare-processor.server.ts`](app/app/services/prepare-processor.server.ts):

- Process multiple pending assets concurrently with a global cap (`PHOTOROOM_CONCURRENCY_MAX`, default 3).
- Enforce **per-shop 1-in-flight** via the shared throttling in `product-prep.server.ts`.
- Before writing prepared image results, enforce precedence:
- record `batchAttemptStartedAt = now()`
- when updating asset, only write `preparedImageKey` if `preparedProductImageUpdatedAt` is null OR `preparedProductImageUpdatedAt <= batchAttemptStartedAt`.
- Update retry classification to treat PhotoRoom typed errors + 429 as retryable with backoff.
- On exhaustion, mark `status=failed` and include error meta.

### 9) Single source-of-truth: prepared image selection

Create [`app/app/services/product-asset/select-prepared-image.server.ts`](app/app/services/product-asset/select-prepared-image.server.ts):

- `selectPreparedImage(productAsset): { key: string, version?: number }` implementing:
1) if `preparedProductImageVersion` and `preparedImageKey` exist → return key + version
2) else if `preparedImageKey` exists → return key
3) else if `preparedImageUrl` exists → attempt to extract GCS key; if not possible, return the URL string

Update call sites to use it (minimal, no UI contract changes):

- [`app/app/routes/app-proxy.see-it-now.render.ts`](app/app/routes/app-proxy.see-it-now.render.ts)
- [`app/app/routes/app-proxy.see-it-now.stream.ts`](app/app/routes/app-proxy.see-it-now.stream.ts)
- [`app/app/routes/app-proxy.product.prepared.ts`](app/app/routes/app-proxy.product.prepared.ts)
- [`app/app/routes/app.products.jsx`](app/app/routes/app.products.jsx) (prepared preview URL generation)
- RenderJob loop selection in [`app/app/services/prepare-processor.server.ts`](app/app/services/prepare-processor.server.ts)

### 10) Replace all `sharp().trim()` usage in prep outputs

For any endpoint that writes a prepared PNG, switch to `trimTransparentPaddingPng` so trimming is:

- alpha-driven (threshold 1)
- deterministic
- consistently applied

Targets (at minimum):

- [`app/app/routes/api.products.remove-background.jsx`](app/app/routes/api.products.remove-background.jsx)
- [`app/app/routes/api.products.apply-mask.jsx`](app/app/routes/api.products.apply-mask.jsx)
- [`app/app/routes/api.products.upload-prepared.jsx`](app/app/routes/api.products.upload-prepared.jsx)
- [`app/app/routes/api.products.use-original.jsx`](app/app/routes/api.products.use-original.jsx)
- [`app/app/routes/api.products.save-refined.jsx`](app/app/routes/api.products.save-refined.jsx)

### 11) Feature flags + rollback docs

Update [`env.example`](env.example) with:

- `IMAGE_PREP_PROVIDER=photoroom`
- `IMAGE_EDGE_ASSIST_PROVIDER=photoroom`
- `PHOTOROOM_API_KEY=`
- `PHOTOROOM_TIMEOUT_MS=30000`
- `PHOTOROOM_RETRY_MAX=1`
- `PHOTOROOM_CONCURRENCY_MAX=3`

Create [`app/MIGRATION.md`](app/MIGRATION.md):

- Output invariants (PNG+alpha+magic bytes+trim always)
- Source-of-truth selection rule
- Flags + defaults
- Rollback steps (flip env without deploy)
- Operational limits (timeout/retry/concurrency/backoff/429)

### 12) Golden test harness

Create [`app/scripts/image-prep-golden-test.ts`](app/scripts/image-prep-golden-test.ts):

- Load images from `app/scripts/golden/product-samples/*.{jpg,jpeg,png}`.
- For each image:
- Run PhotoRoom path via `prepareProductImage({ requestId: "golden-test" ... })`.
- Optionally run legacy path via Prodia buffer-based helper (see below) when `PRODIA_API_TOKEN` exists, so we can compare invariants.
- Assert:
- PNG signature bytes match
- `contentType === "image/png"`
- has alpha channel
- width/height > 0
- trim is tight: each outer edge contains at least one alpha>1 pixel
- Print summary and exit non-zero on failure.

### 13) Tests + cleanup

- Update [`app/app/tests/pipeline/imagePipeline.harness.ts`](app/app/tests/pipeline/imagePipeline.harness.ts) to remove `@imgly` usage and instead exercise `prepareProductImage` + `trimTransparentPaddingPng`.
- After tests pass, perform cleanup:
- remove `@imgly/background-removal-node` dependency from `app/package.json` + lock
- delete [`app/app/types/imgly.d.ts`](app/app/types/imgly.d.ts)
- remove any build config exclusions referencing `@imgly` (e.g. `app/vite.config.js` entry)

### Implementation notes (to avoid known pitfalls)

- PhotoRoom calls must request **`outputSize=originalImage`** and we must set **`export.format=png`**.
- Apply-mask must intersect masks in the **same coordinate space**; trim only at the end.
- Trimming is centralized (no duplicate trimming in routes/services).