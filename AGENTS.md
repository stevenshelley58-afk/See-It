# See It Agent Authority

BUILD-SPEC.md is the source of truth for this repository.

Do not hard-code production prompts as TypeScript constants.
Do not call any AI provider directly from product, merchant, shopper, billing, or render code.
All AI calls go through src/lib/ai/router.ts and create ai_invocation records.
Every render creates render_request, render_attempt, render_asset, and render_trace_event records.
Use durable jobs for critical rendering, replay, evaluation, cutout, billing, and sender work.
Use Shopify theme app extensions and one app proxy root.
Use Supabase Postgres and Supabase Storage contracts.
Keep secrets out of logs, database snapshots, founder UI, and git.
Run pnpm verify before merge.
