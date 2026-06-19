# Operations

## Daily Checks

- Founder home: renders today, accepted rate, gate rejection rate, provider errors, latency, cost, active deployments, and shops needing attention.
- Render operations: dead jobs, failed attempts, gate rejections, manual review queue.
- AI dashboard: degraded providers, disabled models, active experiments, benchmark trends.
- Costs dashboard: spend by provider/model/surface/shop and forecast month-end spend.

## Durable Jobs

Critical work must use the durable job layer:

- `normalize_room`
- `extract_dimensions`
- `generate_cutout`
- `render_request`
- `quality_gate`
- `render_replay`
- `eval_run`
- `lifestyle_generate`
- `push_shopify_media`
- `demo_generate`
- `sync_sender`
- `purge_expired_assets`
- `usage_rollup`
- `daily_digest`

Jobs require idempotency keys. Leased jobs expire if the worker dies. Dead jobs must be visible in founder operations and can be retried after the cause is fixed.

## Cron Routes

All cron routes require `CRON_SECRET` service auth:

- `/api/cron/sweep-jobs`
- `/api/cron/purge-expired`
- `/api/cron/usage-rollup`
- `/api/cron/digest`
- `/api/cron/demo-batch`
- `/api/cron/sync-sender`

The internal sweep route `/api/jobs/sweep` also requires service auth.

## Incident Response

1. Check recent Vercel logs for the route and request ID.
2. Open `/founder/renders/:renderId` for render failures.
3. Check `ai_invocation` redacted request/response and normalized result.
4. Check `render_trace_event` order for missing transitions.
5. Pause bad prompt deployments or experiments before editing prompts.
6. Roll back prompt deployment if quality degradation is prompt-related.
7. Disable or degrade provider/model records if failures are provider-related.

## Secrets

Rotate secrets in Vercel/Supabase/Shopify directly. Never paste secret values into docs, commits, tickets, or founder UI.
