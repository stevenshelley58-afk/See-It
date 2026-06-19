# Status

## Current State

The rebuild has a working Next.js App Router/Supabase codebase with AI control records, provider adapters, durable render jobs, app proxy routes, merchant/founder surfaces, privacy webhooks, billing/quota guards, harness/eval smoke, DB write verification, and storage verification.

The goal is not complete until the Shopify account/dev-store gates and all manual release gates in BUILD-SPEC.md section 24.5 are verified.

## Verified Locally

- Full release verify: `pnpm.cmd run verify`
- Static architecture guard: `pnpm.cmd run static:verify`
- Unit contract coverage: `pnpm.cmd run test` passed 14/14
- Integration contract coverage: `pnpm.cmd run test:integration` passed 3/3
- Harness report generation: `pnpm.cmd run harness:smoke` passed 15/15
- Eval smoke: `pnpm.cmd run eval:smoke` passed 15/15
- Playwright smoke: `pnpm.cmd run e2e:smoke` passed 1/1
- Production build: `pnpm.cmd run build`
- Supabase write smoke: `pnpm.cmd run db:verify:write`
- Supabase storage smoke: `pnpm.cmd run storage:verify`
- AI control-plane seed/readback: active widget render, admin product cutout, and founder prompt eval policies route primary traffic to `gemini/gemini-3.1-flash-image`
- CodeGraph installed and available: `codegraph.cmd --version` reports `1.0.1`
- GitHub CI: latest `main` runs passed for the implementation and release-evidence commits
- Vercel production: deployment reached Ready and is aliased to `https://see-it-nine.vercel.app`
- Production public smoke: `/`, `/privacy`, `/app`, and `/founder/login` returned 200
- Production unauthenticated protection smoke: `/api/founder/ai/providers` and `/api/cron/sweep-jobs` returned 401 without credentials
- Production authenticated founder smoke: founder session returned 303, `/founder`, `/founder/ai`, `/founder/money`, and `/api/founder/ai/providers` returned 200 after rotating encrypted production `FOUNDER_PASSWORD`
- Production authenticated cron smoke: `/api/cron/sweep-jobs` returned 200 after rotating encrypted production `CRON_SECRET`
- Production signed app-proxy smoke: `pnpm.cmd run app-proxy:smoke` passed room creation, room verify, render creation, render status, feedback endpoint, and persisted `render_feedback` row against `https://see-it-nine.vercel.app`
- Production signed webhook smoke: `pnpm.cmd run webhooks:smoke` passed Shopify privacy topics and uninstall against `https://see-it-nine.vercel.app`, including offline-token clearing, room-preview disablement, active-job cancellation, and persisted event checks
- Failed-render handling: `pnpm.cmd run test:integration` verifies gate-rejected renders have no final output asset and expose the friendly retry message used by the widget
- Billing path: accepted ADR `docs/adr/0001-shopify-app-pricing.md` records Shopify App Pricing for public App Store distribution
- Founder AI gates: `pnpm.cmd run test` and `pnpm.cmd run static:verify` cover render instruction inspection, alternate-model replay, prompt rollback, benchmark runs, cost per accepted render, and render-operations visibility
- Manual gate verifier: `pnpm.cmd run manual:gates:template -- --evidence out/manual-gates-evidence.json` generates the required evidence shape, and `pnpm.cmd run manual:gates -- --evidence out/manual-gates-evidence.json` fails until Shopify/dev-store/PDP/Lighthouse/billing/human-review proof is filled in
- Vercel production: latest pushed `main` release candidate reached Ready and is aliased to `https://see-it-nine.vercel.app`
- GitHub CI: latest pushed `main` release candidate passed
- Production runtime logs: no error or fatal entries for the checked production deployment in the post-smoke window

Latest local release verification evidence was recorded on 2026-06-20 AWST:

```powershell
pnpm.cmd run verify
pnpm.cmd run db:verify:write
pnpm.cmd run storage:verify
pnpm.cmd run build
pnpm.cmd run test
pnpm.cmd run test:integration
pnpm.cmd run app-proxy:smoke
pnpm.cmd run webhooks:smoke
pnpm.cmd run manual:gates:template -- --evidence out/manual-gates-evidence.json
```

## Remaining Manual Gates

- Shopify CLI device login.
- Theme app extension deploy.
- Dev-store app install.
- Theme editor block enablement.
- Real PDP shopper happy path.
- Real PDP Lighthouse delta <= 10.
- First merchant render under 5 minutes.
- Install to working PDP button under 10 minutes.
- Human review approval of the generated contact sheet.
- Billing test-mode proof.

## Unblock Command

```powershell
pnpm.cmd dlx @shopify/cli@latest app deploy --no-release --no-color
```

The latest non-interactive retry failed before deploy with Shopify CLI authorization required:

```text
Authorization is required to continue, but the current environment does not support interactive prompts.
```
