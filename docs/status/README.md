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

## Unblock Command

```powershell
pnpm.cmd dlx @shopify/cli@latest app deploy --no-release --no-color
```
