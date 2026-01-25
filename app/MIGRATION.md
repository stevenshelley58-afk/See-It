# Product Prep → PhotoRoom migration

## Output invariants (enforced in code)

- **Trim is always alpha-driven** (threshold alpha > 1) via `trimTransparentPaddingPng()` after any cutout-like output.
- **Prepared outputs are always PNG** with:
  - `contentType: "image/png"` on upload
  - valid PNG magic bytes (validated by `validateMagicBytes(..., "image/png")`)
  - an alpha channel present (`sharp(...).metadata().hasAlpha === true`)

## Source-of-truth for prepared image selection

All render + UI call sites should use `selectPreparedImage(productAsset)`:

1) If `preparedProductImageVersion` and `preparedImageKey` exist → use `preparedImageKey` (plus version).
2) Else if `preparedImageKey` exists → use `preparedImageKey`.
3) Else if `preparedImageUrl` exists → attempt to extract a GCS key; if not possible, fall back to the URL as-is.

## Runtime config (env)

- **`PHOTOROOM_API_KEY`**: PhotoRoom API key
  - Required for manual `/api/products/remove-background`.
  - Used by `/api/products/apply-mask` for clean-edge assist; if unset, apply-mask falls back to the user mask (no AI edge assist).
- **`PHOTOROOM_TIMEOUT_MS`**: total timeout budget (default `30000`)
- **`PHOTOROOM_RETRY_MAX`**: retry count for 429 only (default `1`)
- **`PHOTOROOM_CONCURRENCY_MAX`**: global concurrency cap (default `3`)

## Rollback / mitigation

- **Fast mitigation (no code change)**: unset `PHOTOROOM_API_KEY` to disable PhotoRoom calls.
  - `/api/products/remove-background` will fail fast with a clear error.
  - `/api/products/apply-mask` will still work, but without AI edge assist.
- **Full rollback**: revert the PhotoRoom migration commit(s) and redeploy.

## Operational controls

- **Timeout**: enforced via `PHOTOROOM_TIMEOUT_MS` (AbortController).
- **Retries**: only on HTTP 429 with exponential backoff + jitter, bounded by the total timeout budget.
- **Concurrency**: global cap via `PHOTOROOM_CONCURRENCY_MAX`; per-shop single-flight enforced in the shared prep pipeline.

