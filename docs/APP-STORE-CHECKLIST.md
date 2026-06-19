# App Store Checklist

This checklist is release evidence, not a plan. Mark an item green only after checking the current release candidate.

## Automated Gates

- [ ] `pnpm.cmd run verify`
- [ ] `pnpm.cmd run db:verify:write`
- [ ] `pnpm.cmd run storage:verify`
- [ ] `pnpm.cmd run build`
- [ ] Production deployment Ready in Vercel
- [ ] Production founder protected routes return 200 with founder auth and 307/401 without auth as appropriate
- [ ] Production founder AI APIs return 200 for list endpoints
- [ ] Production cron routes return 401 without secret and 200 with secret
- [ ] Production app proxy room/render/feedback smoke passes with signed Shopify app proxy params
- [ ] Recent production logs show no new 500s after smoke traffic

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

- [ ] 15 shopper fixtures run
- [ ] Automated fixture pass count is >= 13
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
