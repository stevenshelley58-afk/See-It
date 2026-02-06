# See It — Repo Rules (additive to ECC)

## Deploy units (do not blur boundaries)

- `app/` is the **Shopify app** (Remix) deployed to **Railway** via the repo root `Dockerfile`.
- `see-it-monitor/` is the **monitor/control panel** (Next.js) deployed to **Vercel**.

## Secrets & auth (Shopify review sensitive)

- Never expose `MONITOR_API_TOKEN`, `MONITOR_REVEAL_TOKEN`, `SHOPIFY_API_SECRET`, or any API keys to client bundles.
- All monitor-to-app calls must go through `see-it-monitor/app/api/external/*` (server-side proxy).
- All storefront routes must validate Shopify app-proxy auth and scope all queries to the resolved shop.

## Multi-tenant scoping

- Admin app routes must use `authenticate.admin(request)` and scope DB reads/writes by the session shop.
- External API (`/external/v1/*`) must never leak sensitive payloads unless “reveal” is explicitly enabled.

## Schema drift prevention

- The monitor Prisma schema **must remain a strict subset** of the app schema.
- Keep `cd app && npm run check:consistency` passing.

## Quality bar

- Prefer deletion over new abstractions.
- Avoid “temporary” endpoints in production unless gated and authenticated.
- Add tests for any new security/observability behavior.

