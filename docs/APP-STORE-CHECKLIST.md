# App Store Checklist

This checklist is release evidence, not a plan. Mark an item green only after checking the current release candidate.

## Automated Gates

- [x] `pnpm.cmd run verify`
- [x] `pnpm.cmd run db:verify:write`
- [x] `pnpm.cmd run storage:verify`
- [x] `pnpm.cmd run build`
- [x] Production deployment Ready in Vercel
- [ ] Production founder protected routes return 200 with founder auth and 307/401 without auth as appropriate
- [ ] Production founder AI APIs return 200 for list endpoints
- [ ] Production cron routes return 401 without secret and 200 with secret
- [ ] Production app proxy room/render/feedback smoke passes with signed Shopify app proxy params
- [x] Recent production logs show no new 500s after smoke traffic

## Shopify App Store Requirements

- [ ] Shopify OAuth install works on dev store
- [ ] Theme app extension deploys successfully
- [ ] Theme editor shows the `See it in your room` block
- [ ] Merchant can enable one product without support
- [ ] Install to working PDP button completes under 10 minutes
- [ ] First merchant render completes under 5 minutes
- [ ] Shopper room upload/tap/result path works on mobile and desktop
- [ ] Bad render is hidden behind friendly retry state
- [ ] Shopper feedback writes `render_feedback`
- [ ] PDP Lighthouse performance delta is <= 10 points
- [ ] Widget initial JS is < 30 KB
- [ ] Billing path uses Shopify App Pricing or has an accepted ADR for manual Billing API
- [ ] Billing test mode works before App Store submission
- [ ] Privacy webhooks pass
- [ ] Uninstall disables shop state and cancels active jobs
- [ ] Public privacy policy describes temporary room-photo processing and retention

## AI And Render Gates

- [x] 15 shopper fixtures run
- [x] Automated fixture pass count is >= 13
- [ ] Human contact sheet review is complete
- [ ] No product identity failures in approved cases
- [ ] Founder can inspect every AI instruction for a render
- [ ] Founder can replay a render with a different model
- [ ] Founder can roll back active prompt deployment
- [ ] Model comparison benchmark works
- [ ] Cost dashboard shows cost per accepted render
- [ ] Render operations dashboard shows attempts, assets, prompt snapshots, provider responses, gate scores, retries, and feedback

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
- Vercel runtime logs had no error or fatal entries for the checked production deployment in the post-deploy window.

Authenticated founder and cron production smoke remains blocked because the active Vercel production `FOUNDER_PASSWORD` and `CRON_SECRET` are sensitive encrypted values and are not retrievable by `vercel env pull` or `vercel env run`. They must be rotated to known values before the authenticated 200 checks can be completed:

```powershell
vercel.cmd env update FOUNDER_PASSWORD production --value "<known-founder-password>" --yes
vercel.cmd env update CRON_SECRET production --value "<known-cron-secret>" --yes
vercel.cmd --prod --yes
```
