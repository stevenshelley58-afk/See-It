# Build Runbook

BUILD-SPEC.md is the source of truth. A release candidate is not complete until all automated gates pass and the Shopify/manual gates are checked against the current deployment.

## Local Verification

Run from `C:\Dev\See It`:

```powershell
pnpm.cmd install
pnpm.cmd run verify
pnpm.cmd run db:verify:write
pnpm.cmd run storage:verify
pnpm.cmd run build
```

`pnpm.cmd run verify` expands to lint, typecheck, unit tests, integration tests, harness smoke, eval smoke, Playwright smoke, and static verification.

## Production Verification

After merge/deploy:

1. Confirm Vercel deployment is Ready.
2. Run DB write smoke with production Supabase env available:
   ```powershell
   pnpm.cmd run db:verify:write
   ```
3. Run storage verification:
   ```powershell
   pnpm.cmd run storage:verify
   ```
4. Smoke public pages, founder pages, founder APIs, cron auth, and app proxy routes against the production URL.
5. Query recent deployment logs for 500s after smoke traffic.

## Shopify Gate

The Shopify CLI command for extension deployment is:

```powershell
pnpm.cmd dlx @shopify/cli@latest app deploy --no-release --no-color
```

This requires Shopify account/device-code login. After login:

1. Deploy the theme app extension.
2. Install the app on the dev store.
3. Enable the `See it in your room` app block in the theme editor.
4. Complete merchant onboarding to a working product page.
5. Run a shopper room upload/tap/result/refine/feedback test on the dev store.
6. Measure PDP Lighthouse performance before and after enabling the block; delta must be <= 10 points.

## Release Rule

Do not mark the build complete while any manual gate in BUILD-SPEC.md section 24.5 is unverified.
