# AI Control Center

BUILD-SPEC.md is the authority. This document describes the operational contract for `/founder/ai` and `/api/founder/ai/*`.

## Data Model

AI behavior is controlled by database records:

- `ai_provider`: provider metadata, adapter key/version, status, docs URL, and secret reference only.
- `ai_model`: model key/version, capabilities, allowed tasks, limits, pricing, and docs URL.
- `model_route_policy`: primary, fallback, escalation, cost, latency, and attempt policy.
- `prompt_template` and `prompt_version`: versioned instructions, variables, negative prompts, params, output schema, and hashes.
- `prompt_bundle` and `prompt_bundle_version`: task-to-prompt-version mappings.
- `render_recipe` and `render_recipe_version`: prompt bundle, route policy, gate/retry/storage/output policies.
- `prompt_deployment`: active, paused, or rolled-back production traffic state.
- `audit_log`: founder changes to AI control records.

Raw provider API keys must stay in env/secret manager. Founder UI and database records use `secretRef`, never secret values.

## API Surface

The section 19 API surface is served by `src/app/api/founder/ai/[...segments]/route.ts`.

Required list/read actions:

- `GET /api/founder/ai/providers`
- `GET /api/founder/ai/models`
- `GET /api/founder/ai/prompts`
- `GET /api/founder/ai/prompts/:id`
- `GET /api/founder/ai/bundles`
- `GET /api/founder/ai/recipes`
- `GET /api/founder/ai/deployments`

Required mutation actions:

- `POST /api/founder/ai/providers`
- `PATCH /api/founder/ai/providers/:id`
- `POST /api/founder/ai/models`
- `PATCH /api/founder/ai/models/:id`
- `POST /api/founder/ai/prompts`
- `POST /api/founder/ai/prompts/:id/versions`
- `POST /api/founder/ai/prompt-versions/:id/approve`
- `POST /api/founder/ai/prompt-versions/:id/archive`
- `POST /api/founder/ai/bundles`
- `POST /api/founder/ai/bundle-versions/:id/approve`
- `POST /api/founder/ai/recipes`
- `POST /api/founder/ai/recipe-versions/:id/approve`
- `POST /api/founder/ai/deployments`
- `POST /api/founder/ai/deployments/:id/rollback`
- `POST /api/founder/ai/deployments/:id/pause`
- `POST /api/founder/ai/test-render`
- `POST /api/founder/ai/benchmark`
- `POST /api/founder/ai/replay`

## Verification

Run:

```powershell
pnpm.cmd run test
pnpm.cmd run static:verify
```

The unit contract imports the actual Next route handlers and exercises provider/model creation and patching, bundle and recipe approval, deployment activation, prompt test render, benchmark creation, and replay creation.

Before production traffic:

1. Confirm no product route imports provider adapters directly.
2. Confirm prompt deployment points at approved prompt bundle and recipe versions.
3. Run `pnpm.cmd run harness:smoke` and open `out/harness-report.html`.
4. Record founder manual review for required cases before traffic promotion.
