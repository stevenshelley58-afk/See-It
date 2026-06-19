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
- Production runtime logs: no error or fatal entries for the checked production deployment in the post-deploy window

Latest local release verification evidence was recorded on 2026-06-20 AWST:

```powershell
pnpm.cmd run verify
pnpm.cmd run db:verify:write
pnpm.cmd run storage:verify
pnpm.cmd run build
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
- Authenticated founder and cron production smoke, because the current Vercel production `FOUNDER_PASSWORD` and `CRON_SECRET` are sensitive encrypted values and are not retrievable locally.

## Unblock Command

```powershell
pnpm.cmd dlx @shopify/cli@latest app deploy --no-release --no-color
```

For authenticated founder and cron smoke, rotate to known values and redeploy:

```powershell
vercel.cmd env update FOUNDER_PASSWORD production --value "<known-founder-password>" --yes
vercel.cmd env update CRON_SECRET production --value "<known-cron-secret>" --yes
vercel.cmd --prod --yes
```
