# Status

## Current State

The rebuild has a working Next.js App Router/Supabase codebase with AI control records, provider adapters, durable render jobs, app proxy routes, merchant/founder surfaces, privacy webhooks, billing/quota guards, harness/eval smoke, DB write verification, and storage verification.

The goal is not complete until the Shopify account/dev-store gates and all manual release gates in BUILD-SPEC.md section 24.5 are verified.

## Verified Locally

- Static architecture guard: `pnpm.cmd run static:verify`
- Unit contract coverage: `pnpm.cmd run test`
- Harness report generation: `pnpm.cmd run harness:smoke`

Full release verification also requires:

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
