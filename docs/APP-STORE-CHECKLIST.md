# App Store Checklist

This checklist is release evidence, not a plan. Mark an item green only after checking the current release candidate.

## Automated Gates

- [x] `pnpm.cmd run verify`
- [x] `pnpm.cmd run db:verify:write`
- [x] `pnpm.cmd run storage:verify`
- [x] `pnpm.cmd run build`
- [x] Production deployment Ready in Vercel
- [x] Production founder protected routes return 200 with founder auth and 307/401 without auth as appropriate
- [x] Production founder AI APIs return 200 for list endpoints
- [x] Production cron routes return 401 without secret and 200 with secret
- [x] Production app proxy room/render/feedback smoke passes with signed Shopify app proxy params
- [x] Production Shopify privacy and uninstall webhooks pass with signed HMAC traffic
- [x] Recent production logs show no new 500s after smoke traffic

## Shopify App Store Requirements

- [ ] Shopify OAuth install works on dev store
- [ ] Theme app extension deploys successfully
- [ ] Theme editor shows the `See it in your room` block
- [ ] Merchant can enable one product without support
- [ ] Install to working PDP button completes under 10 minutes
- [ ] First merchant render completes under 5 minutes
- [ ] Shopper room upload/tap/result path works on mobile and desktop
- [x] Bad render is hidden behind friendly retry state
- [x] Shopper feedback writes `render_feedback`
- [ ] PDP Lighthouse performance delta is <= 10 points
- [x] Widget initial JS is < 30 KB
- [x] Billing path uses Shopify App Pricing or has an accepted ADR for manual Billing API
- [ ] Billing test mode works before App Store submission
- [x] Privacy webhooks pass
- [x] Uninstall disables shop state and cancels active jobs
- [x] Public privacy policy describes temporary room-photo processing and retention

## AI And Render Gates

- [x] 15 shopper fixtures run
- [x] Automated fixture pass count is >= 13
- [ ] Human contact sheet review is complete
- [ ] No product identity failures in approved cases
- [x] Founder can inspect every AI instruction for a render
- [x] Founder can replay a render with a different model
- [x] Founder can roll back active prompt deployment
- [x] Model comparison benchmark works
- [x] Cost dashboard shows cost per accepted render
- [x] Render operations dashboard shows attempts, assets, prompt snapshots, provider responses, gate scores, retries, and feedback

## Current External Blocker

The Shopify CLI deploy/dev-store gates require Shopify account device-code login:

```powershell
pnpm.cmd dlx @shopify/cli@latest app deploy --no-release --no-color
```

Until that login and dev-store validation are completed, App Store readiness is not green.

## Latest Automated Evidence

Recorded on 2026-06-20 AWST from `C:\Dev\See It`:

- `pnpm.cmd run verify` passed: lint, typecheck, unit 14/14, integration 3/3, harness 15/15, eval 15/15, Playwright smoke 1/1, static architecture guard.
- `pnpm.cmd run build` passed with 37 generated static pages and all expected dynamic API, founder, merchant, demo, privacy, and app-proxy routes.
- `pnpm.cmd run db:verify:write` passed against Supabase: 35 clean schema tables, seeded AI rows, and write smoke.
- `pnpm.cmd run storage:verify` passed for buckets `rooms`, `products`, `renders`, `ai-debug`, `evals`, `demo-assets`, and `exports`.
- `pnpm.cmd run seed:ai` passed and live route-policy readback shows active primary routes for widget render, product cutout, and founder prompt eval use `gemini/gemini-3.1-flash-image`.
- GitHub CI passed for the implementation and release-evidence commits on `main`.
- Vercel production deployment reached Ready and is aliased to `https://see-it-nine.vercel.app`.
- Production public smoke passed: `/`, `/privacy`, `/app`, and `/founder/login` returned 200.
- Production unauthenticated protection smoke passed: `/api/founder/ai/providers` and `/api/cron/sweep-jobs` returned 401 without credentials.
- Production authenticated founder smoke passed after rotating encrypted production `FOUNDER_PASSWORD`: founder session returned 303, `/founder`, `/founder/ai`, `/founder/money`, and `/api/founder/ai/providers` returned 200.
- Production authenticated cron smoke passed after rotating encrypted production `CRON_SECRET`: `/api/cron/sweep-jobs` returned 200 with the secret.
- `pnpm.cmd run app-proxy:smoke` passed against `https://see-it-nine.vercel.app`: signed app-proxy room creation, room verify, render creation, render status, feedback endpoint, and persisted `render_feedback` row all passed.
- `pnpm.cmd run webhooks:smoke` passed against `https://see-it-nine.vercel.app`: signed privacy topics and uninstall returned 200, uninstall cleared the offline token, disabled room preview, cancelled the seeded active job, and persisted the expected event names.
- `pnpm.cmd run test:integration` proves gate-rejected renders end as failed without final output assets and carry the friendly retry message.
- `pnpm.cmd run test` covers founder replay with alternate model, prompt rollback, benchmark creation/reuse, manual review records, eval results, experiments, billing/quota, and Shopify auth contracts.
- `pnpm.cmd run static:verify` guards founder render details, replay, deployments, benchmark/evals, experiments, cost, and render-operations pages against losing their durable data hooks or required spec copy.
- `pnpm.cmd run static:verify` checks the widget bundle budget; current widget bundle is below the 30 KB initial-JS gate.
- `docs/adr/0001-shopify-app-pricing.md` is accepted and records Shopify App Pricing as the App Store billing path.
- Vercel production deployment `dpl_HA2nio39nr73WK8vNFaCArcySVmQ` is Ready for commit `5bfafa43a75b723b962144ee187cfda346d2d793`.
- GitHub CI passed for commit `5bfafa43a75b723b962144ee187cfda346d2d793`.
- Vercel runtime logs had no error or fatal entries for deployment `dpl_HA2nio39nr73WK8vNFaCArcySVmQ` in the post-smoke window.
