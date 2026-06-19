# BUILD-SPEC.md

## See It New Build Specification

**Version:** 1.0
**Date:** June 19, 2026
**Purpose:** Replace the prior Codex rebuild plan with a new source-of-truth spec optimized for model swapping, prompt control, render observability, replay, evaluation, and Shopify launch readiness.

This spec supersedes the old plan. The major correction is that AI behavior must not be hard-coded in TypeScript prompt constants. The new build must treat every model, prompt, instruction, parameter, image input, provider response, gate decision, and generated image as inspectable, versioned, replayable system data. The prior plan had useful product scope, Shopify surfaces, schema direction, and render harness ideas, but its “no prompt tables” and “model changes by deploy” approach conflicts with the level of model control now required.

---

## 1. Product Being Built

See It is a Shopify app for visualizing products in real shopper rooms and generating merchant lifestyle content.

### 1.1 Paid value surfaces

#### A. Shopper PDP widget

A merchant enables a **“See it in your room”** block on Shopify product pages.

Shopper flow:

1. Shopper opens widget.
2. Shopper uploads or captures a room photo.
3. Shopper taps where the product should go.
4. App generates a true-to-scale render of the exact product in the shopper’s room.
5. App runs a fidelity gate.
6. Good render is shown.
7. Bad render is hidden and replaced with a friendly retry state.
8. Shopper can refine up to 3 times.
9. Shopper can submit feedback.

#### B. Merchant lifestyle studio

Merchant flow:

1. Merchant selects a product.
2. App extracts product dimensions and metadata.
3. Merchant confirms or edits dimensions.
4. App creates or uploads a clean product cutout.
5. Merchant chooses room scenes or prompt recipes.
6. App generates lifestyle images.
7. Merchant approves images.
8. Approved images can be pushed to Shopify product media.

#### C. Founder AI control and render operations

Founder flow:

1. View every AI model available to the system.
2. Enable, disable, or route models by surface.
3. View every prompt and instruction sent to an AI model.
4. Compare prompt versions.
5. Test prompts against fixtures.
6. Run model comparisons.
7. Replay historical renders with new prompts or models.
8. See every render attempt end to end.
9. Debug failed renders using input assets, prompt snapshots, provider responses, gate scores, costs, latency, retries, and user feedback.

---

## 2. Non-Negotiable Architecture Rules

### 2.1 Model swapping must be first-class

No product code may call Gemini, OpenAI, Flux, Ideogram, Reve, or any future model directly.

All AI calls go through:

```text
AI Router
→ Capability resolver
→ Model route policy
→ Provider adapter
→ AI invocation logger
→ Result normalizer
→ Evaluation/gate pipeline
```

Adding a new model must not require changes to shopper widget, merchant UI, render orchestration, prompt control center, billing, event logging, or dashboards.

### 2.2 Every AI instruction must be observable

Every AI call must store a complete audit snapshot:

```text
provider
model
adapter version
surface
task type
prompt template id
prompt version id
render recipe id
resolved prompt text
system/developer/user instructions where applicable
negative prompt where applicable
image input order
image input roles
provider parameters
safety settings
seed if available
request payload with secrets removed
raw provider response with secrets removed
normalized response
output asset keys
latency
cost estimate
error details
```

### 2.3 Prompts are data, not hard-coded constants

Prompt templates and prompt versions live in the database and are managed through the founder-only Prompt Control Center.

Code may contain fallback seed prompts for local bootstrap only. Production behavior uses approved prompt versions and prompt deployments.

### 2.4 Render observability is product infrastructure

Every generated image must be traceable from:

```text
shopper or merchant action
→ render request
→ input assets
→ prompt compilation
→ model route decision
→ provider attempt
→ output storage
→ gate scoring
→ retry or escalation
→ final result
→ feedback
→ replay or benchmark
```

### 2.5 Critical jobs must be durable

Rendering, replay, evaluation runs, cutout generation, lifestyle generation, demo generation, billing sync, and sender sync must use a durable job layer.

Next.js `after()` is acceptable for logging and analytics side effects, but the official docs describe it as post-response work for tasks such as logging and analytics, not as a durable execution system. Vercel functions also have maximum duration limits, so critical render jobs must not rely only on response-lifecycle execution. ([Next.js][1])

---

## 3. Platform Decisions

### 3.1 Framework

```text
Framework: Next.js App Router
Runtime: Vercel Node runtime
Database: Supabase Postgres
Storage: Supabase Storage
Language: TypeScript
Package manager: pnpm
Tests: Vitest + Playwright
UI: React
Shopify surface: embedded admin app + theme app extension + app proxy
```

### 3.2 Shopify integration

Use a Shopify theme app extension for the storefront widget because Shopify theme app extensions expose app blocks in the theme editor, can be deployed across stores, are versioned, and avoid merchants manually editing theme code. ([Shopify][2])

Use one app proxy root for storefront dynamic routes. Shopify app proxy documentation states an app can have only one proxy route configured and child paths under that root proxy to the app. ([Shopify][3])

The app must protect storefront performance. Shopify’s App Store best-practice page says an app should not reduce Lighthouse performance scores by more than 10 points. ([Shopify][4])

### 3.3 Billing

For public App Store distribution, default to **Shopify App Pricing** unless an ADR documents a valid reason for manual Billing API use. Shopify describes App Pricing as the default and recommended approach for App Store apps, and says App Store apps must use a Shopify-provided billing solution. ([Shopify][5])

### 3.4 Privacy and compliance

Implement Shopify compliance webhooks:

```text
customers/data_request
customers/redact
shop/redact
```

Shopify sends `customers/data_request` payloads to installed apps when customers request their data, so these webhook topics must be explicitly configured and tested even if See It stores no shopper accounts. ([Shopify][6])

### 3.5 Storage uploads

Browser uploads go direct to Supabase signed upload URLs. Supabase signed upload URLs can upload without further authentication and are valid for 2 hours, so the widget must handle upload URL expiry and retry. ([Supabase][7])

---

## 4. Target Repo Shape

```text
C:\Dev\See It
├── AGENTS.md
├── BUILD-SPEC.md
├── PRODUCT-BACKLOG.md
├── RELEASE-BASELINE.md
├── RISK-REGISTER.md
├── SOURCE-REGISTER.md
├── ASSUMPTIONS.md
├── DESIGN.md
├── package.json
├── pnpm-lock.yaml
├── next.config.mjs
├── eslint.config.mjs
├── tsconfig.json
├── vercel.json
├── shopify.app.toml
├── .env.example
├── docs
│   ├── adr
│   ├── BUILD-RUNBOOK.md
│   ├── APP-STORE-CHECKLIST.md
│   ├── OPERATIONS.md
│   ├── AI-CONTROL-CENTER.md
│   ├── RENDER-OBSERVABILITY.md
│   ├── PRIVACY-RETENTION.md
│   └── status
├── src
│   ├── app
│   │   ├── page.tsx
│   │   ├── layout.tsx
│   │   ├── app
│   │   │   ├── page.tsx
│   │   │   ├── onboarding
│   │   │   ├── products
│   │   │   ├── lifestyle
│   │   │   ├── billing
│   │   │   └── settings
│   │   ├── founder
│   │   │   ├── page.tsx
│   │   │   ├── ai
│   │   │   ├── renders
│   │   │   ├── evals
│   │   │   ├── experiments
│   │   │   ├── quality
│   │   │   ├── customers
│   │   │   ├── money
│   │   │   └── outreach
│   │   ├── demo
│   │   │   └── [slug]
│   │   ├── app-proxy
│   │   │   ├── rooms
│   │   │   ├── renders
│   │   │   ├── renders/[renderId]
│   │   │   ├── renders/[renderId]/refine
│   │   │   ├── renders/[renderId]/feedback
│   │   │   └── events
│   │   └── api
│   │       ├── auth
│   │       ├── merchant
│   │       ├── founder
│   │       ├── webhooks
│   │       ├── cron
│   │       └── jobs
│   ├── lib
│   │   ├── env.ts
│   │   ├── supabase.ts
│   │   ├── db
│   │   ├── storage
│   │   ├── jobs
│   │   ├── events
│   │   ├── ai
│   │   │   ├── router.ts
│   │   │   ├── types.ts
│   │   │   ├── registry.ts
│   │   │   ├── capabilities.ts
│   │   │   ├── prompt-compiler.ts
│   │   │   ├── prompt-hash.ts
│   │   │   ├── cost.ts
│   │   │   ├── redaction.ts
│   │   │   └── providers
│   │   │       ├── gemini.ts
│   │   │       ├── openai.ts
│   │   │       ├── flux.ts
│   │   │       ├── ideogram.ts
│   │   │       ├── reve.ts
│   │   │       ├── custom-http.ts
│   │   │       └── local.ts
│   │   ├── render
│   │   │   ├── orchestrator.ts
│   │   │   ├── recipes.ts
│   │   │   ├── gate.ts
│   │   │   ├── replay.ts
│   │   │   ├── evals.ts
│   │   │   ├── image-assets.ts
│   │   │   ├── cutout.ts
│   │   │   └── trace.ts
│   │   ├── shopify
│   │   ├── merchant
│   │   ├── shopper
│   │   ├── founder
│   │   ├── growth
│   │   └── security
│   └── styles
├── extension
│   ├── shopify.extension.toml
│   ├── blocks
│   ├── snippets
│   └── assets
├── scripts
│   ├── render.ts
│   ├── replay.ts
│   ├── eval.ts
│   ├── harness.ts
│   ├── seed-ai-registry.ts
│   ├── seed-dev.ts
│   ├── verify.ts
│   ├── enrich.ts
│   └── demo-batch.ts
├── fixtures
│   ├── render-fixtures.json
│   ├── eval-datasets
│   └── cases
├── tests
│   ├── unit
│   ├── integration
│   └── e2e
└── supabase
    └── migrations
```

---

## 5. Environment Contract

### 5.1 Required env vars

```text
APP_ENV
APP_URL
DATABASE_URL
SUPABASE_URL
SUPABASE_SERVICE_KEY
SUPABASE_ANON_KEY
SHOPIFY_API_KEY
SHOPIFY_API_SECRET
SHOPIFY_APP_URL
SHOPIFY_API_VERSION
FOUNDER_PASSWORD
CRON_SECRET
ENCRYPTION_KEY
DEMO_BASE_URL
```

### 5.2 Optional provider env vars

```text
GEMINI_API_KEY
OPENAI_API_KEY
BFL_API_KEY
IDEOGRAM_API_KEY
REVE_API_KEY
CUSTOM_IMAGE_API_KEY
CUSTOM_IMAGE_API_BASE_URL
LOCAL_IMAGE_MODEL_BASE_URL
```

### 5.3 Optional growth env vars

```text
INSTANTLY_API_KEY
ZEROBOUNCE_API_KEY
FOUNDER_EMAIL
SUPPORT_EMAIL
```

### 5.4 Env rules

```text
No direct process.env outside src/lib/env.ts.
Required env vars crash boot with named errors.
Optional provider keys create disabled provider status if missing.
Secrets are never shown in founder UI.
Database stores provider metadata and secret references, not raw API keys.
```

---

## 6. AI Provider Architecture

## 6.1 Core principle

All AI providers must conform to one internal contract.

Provider differences live only in provider adapters.

### 6.2 Provider adapter interface

```ts
export type AiTaskType =
  | "product_dimension_extract"
  | "product_cutout"
  | "room_analysis"
  | "render_composite"
  | "render_refine"
  | "lifestyle_generate"
  | "quality_gate"
  | "prompt_eval"
  | "caption"
  | "personalization";

export type AiInputAsset = {
  role:
    | "product_image"
    | "product_cutout"
    | "room_image"
    | "previous_render"
    | "mask"
    | "reference"
    | "style_reference";
  storageKey: string;
  mimeType: string;
  width?: number;
  height?: number;
  sha256?: string;
  order: number;
};

export type AiInvocationRequest = {
  traceId: string;
  surface: "widget" | "admin" | "founder" | "demo" | "cron" | "system";
  taskType: AiTaskType;
  providerKey: string;
  modelKey: string;
  modelVersion?: string;
  promptSnapshot: {
    promptTemplateId: string;
    promptVersionId: string;
    promptBundleVersionId?: string;
    renderRecipeVersionId?: string;
    resolvedSystemInstruction?: string;
    resolvedDeveloperInstruction?: string;
    resolvedUserPrompt: string;
    resolvedNegativePrompt?: string;
    variablesJson: Record<string, unknown>;
    promptHash: string;
  };
  assets: AiInputAsset[];
  params: {
    aspectRatio?: string;
    size?: string;
    quality?: string;
    seed?: number;
    temperature?: number;
    guidanceScale?: number;
    outputFormat?: "png" | "jpg" | "webp";
    safety?: Record<string, unknown>;
    providerSpecific?: Record<string, unknown>;
  };
  idempotencyKey: string;
};

export type AiNormalizedResult = {
  ok: boolean;
  outputAssets: Array<{
    role: "image" | "mask" | "json" | "text" | "debug";
    storageKey?: string;
    text?: string;
    json?: unknown;
    mimeType?: string;
    width?: number;
    height?: number;
    sha256?: string;
  }>;
  providerResponseId?: string;
  finishReason?: string;
  safetyJson?: unknown;
  usageJson?: unknown;
  costEstimateUsd?: number;
  rawResponseRedactedJson?: unknown;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    providerStatus?: number;
    rawErrorRedactedJson?: unknown;
  };
  latencyMs: number;
};

export interface AiProviderAdapter {
  providerKey: string;
  adapterVersion: string;

  supports(model: AiModelRecord, taskType: AiTaskType): boolean;

  invoke(
    request: AiInvocationRequest,
    model: AiModelRecord
  ): Promise<AiNormalizedResult>;

  estimateCost?(
    request: AiInvocationRequest,
    model: AiModelRecord
  ): Promise<number | null>;

  validateParams?(
    params: AiInvocationRequest["params"],
    model: AiModelRecord
  ): void;
}
```

### 6.3 Provider support at launch

Initial adapters:

```text
gemini
openai
custom-http
local
```

Planned adapters:

```text
flux
ideogram
reve
```

The initial Gemini and OpenAI adapters should be built against the current official docs. Gemini image docs currently show `gemini-3.1-flash-image` and `gemini-3-pro-image` image generation examples. OpenAI image docs currently show `gpt-image-2`, and state that `input_fidelity` should be omitted for that model because it processes image inputs at high fidelity automatically. ([Google AI for Developers][8])

### 6.4 Capability registry

Every model must declare capabilities. Product code must check capabilities, not provider names.

```text
text_to_image
image_edit
multi_image_reference
ordered_image_inputs
mask_edit
transparent_background
aspect_ratio_control
size_control
seed_control
style_reference
negative_prompt
safety_settings
async_response
sync_response
json_output
cost_estimate
raw_usage
high_fidelity_reference
```

### 6.5 Adding or swapping a model

#### Add model on existing provider

1. Insert or update `ai_model`.
2. Configure capabilities.
3. Configure allowed tasks.
4. Add pricing snapshot if known.
5. Add model to route policy.
6. Run provider contract test.
7. Run benchmark suite.
8. Deploy to 0 percent traffic.
9. Promote through experiment or manual deployment.

No render pipeline code changes.

#### Add new provider

1. Add provider adapter file.
2. Add provider contract tests.
3. Add provider row in `ai_provider`.
4. Add model rows in `ai_model`.
5. Add capability rows.
6. Add route policy.
7. Run benchmark suite.
8. Deploy behind founder-only flag.

No shopper, merchant, prompt, replay, or evaluation code changes.

---

## 7. Prompt Control Center

### 7.1 Route root

```text
/founder/ai
```

### 7.2 Access

Founder only.

```text
FOUNDER_PASSWORD required
No merchant access
No public access
All writes logged to audit_log
```

### 7.3 Pages

```text
/founder/ai
/founder/ai/providers
/founder/ai/models
/founder/ai/prompts
/founder/ai/prompts/[promptId]
/founder/ai/bundles
/founder/ai/recipes
/founder/ai/deployments
/founder/ai/experiments
/founder/ai/test-lab
/founder/ai/replay
/founder/ai/costs
/founder/ai/audit
```

### 7.4 Prompt objects

A prompt is not one text field. It is a controlled object.

```text
prompt_template
prompt_version
prompt_bundle
prompt_bundle_version
render_recipe
render_recipe_version
prompt_deployment
ai_experiment
```

### 7.5 Prompt version fields

```text
name
task_type
surface
status: draft/review/approved/active/archived
system_instruction
developer_instruction
user_prompt_template
negative_prompt_template
variables_schema_json
output_schema_json
allowed_asset_roles_json
required_asset_order_json
default_params_json
notes
created_by
approved_by
created_at
approved_at
```

### 7.6 Prompt bundle

A bundle groups the prompts used by one full render flow.

Example shopper render bundle:

```text
room_analysis_prompt
render_composite_prompt
quality_gate_prompt
refine_prompt
failure_explanation_prompt
```

### 7.7 Render recipe

A recipe combines:

```text
surface
task type
prompt bundle version
model route policy
quality gate policy
fallback policy
retry policy
output format
storage retention policy
experiment eligibility
```

### 7.8 Required control center actions

```text
Create prompt draft
Edit prompt draft
Preview resolved prompt with variables
View image input roles and order
Diff prompt versions
Approve prompt version
Activate prompt deployment
Rollback prompt deployment
Archive prompt version
Clone prompt version
Run one-off prompt test
Run fixture suite
Run benchmark against model set
Compare model outputs side by side
Promote experiment winner
View every render using a prompt version
Block a prompt version from production
```

### 7.9 Prompt deployment rules

```text
Draft prompts cannot receive production traffic.
Approved prompts can be tested and benchmarked.
Active prompts can receive production traffic.
Rollback creates a deployment event, not a database mutation of history.
Historical renders always keep their original resolved prompt snapshot.
```

---

## 8. Render Observability

## 8.1 Route root

```text
/founder/renders
```

### 8.2 Render list page

Filters:

```text
date range
shop
product
surface
kind: shopper/lifestyle/demo/test/replay/eval
status
provider
model
prompt version
recipe version
gate pass/fail
error code
latency range
cost range
feedback up/down
has replay
has manual review
```

Columns:

```text
created_at
render_id
shop
surface
product
status
provider/model
prompt version
gate score
cost
latency
attempts
feedback
open
```

### 8.3 Render detail page

Each render detail page must show:

```text
Trace timeline
Input product image
Input product cutout
Input room image
Tap marker
Product dimensions
Product metadata
Prompt bundle
Resolved prompt text
Resolved system/developer/user instructions
Negative prompt
Variables used
Image input order
Model route decision
Provider request JSON, redacted
Provider raw response JSON, redacted
Provider normalized response
Every intermediate image
Every final generated image
Gate input images
Gate prompt and model
Gate score and notes
Retry and escalation history
Failure code and stack summary
Latency by stage
Cost by attempt
Usage tokens or provider usage fields
Storage keys
Asset SHA256 hashes
User feedback
Manual review notes
Replay button
Benchmark button
Promote output to fixture button
```

### 8.4 Trace events

Every render has a `trace_id`.

Required trace event names:

```text
render_request_created
asset_upload_url_issued
asset_upload_verified
room_normalized
product_cutout_selected
prompt_bundle_resolved
model_route_selected
ai_invocation_created
provider_request_sent
provider_response_received
provider_output_stored
quality_gate_started
quality_gate_completed
render_retry_scheduled
render_escalated
render_accepted
render_rejected
render_failed
render_result_signed
render_shown
feedback_submitted
replay_created
manual_review_submitted
```

### 8.5 Render retention

Default retention:

```text
shopper room original: 24 hours
shopper normalized room: 24 hours
shopper generated render: 7 days
shopper trace metadata: 180 days
merchant test assets: 90 days
lifestyle assets: until merchant deletes or uninstall policy applies
demo assets: 30 days unless converted
eval fixtures: indefinite until removed by founder
```

Reason: full observability is required, but shopper room photos may contain personal or sensitive information. If assets are purged, replay must show “asset unavailable due to retention policy” and still preserve metadata, prompt snapshots, provider metadata, gate scores, and feedback.

---

## 9. Render Replay

### 9.1 Purpose

Replay lets the founder rerun any historical render against:

```text
same prompt and same model
same prompt and new model
new prompt and same model
new prompt and new model
new recipe
new gate policy
new fallback policy
```

### 9.2 Replay rules

```text
Replay creates a new render_request with kind = replay.
Replay links to source_render_request_id.
Replay never mutates the original render.
Replay uses retained source assets only.
Replay stores full prompt/model/adapter snapshots.
Replay outputs are never shown to shoppers.
Replay can be promoted into eval fixtures.
Replay can be compared side by side with original.
```

### 9.3 Replay UI

```text
/founder/ai/replay
/founder/renders/[renderId]/replay
```

Replay controls:

```text
select source render
select prompt bundle version
select render recipe version
select provider/model
select quality/size/params
select gate policy
run once
run across model set
run across prompt set
run full benchmark
```

---

## 10. Experiments and A/B Testing

### 10.1 Experiment types

```text
prompt_version_test
model_test
recipe_test
gate_threshold_test
fallback_policy_test
parameter_test
```

### 10.2 Experiment assignment

Assignment must be deterministic.

Default assignment keys:

```text
shopper widget: hash(shop_id + product_setup_id + room_session_id)
merchant test: hash(shop_id + product_setup_id + user session)
demo: hash(prospect_id + demo_slug)
```

### 10.3 Experiment safety

```text
Only approved prompt versions can enter experiments.
Only enabled models can enter experiments.
Experiments start at 0 percent.
Founder must manually raise traffic.
Any arm with high gate rejection or provider errors auto-pauses.
Shopper never sees failed gated outputs.
```

### 10.4 Experiment metrics

```text
gate pass rate
manual quality score
product fidelity score
scale plausibility score
artifact score
latency p50/p95
cost per accepted render
retry rate
escalation rate
thumbs down rate
render-to-add-to-cart rate
merchant approval rate
```

---

## 11. Evaluation and Benchmarking

### 11.1 Eval datasets

Initial datasets:

```text
shopper_core_15
scale_sensitive_20
lighting_hard_20
furniture_large_20
wall_items_20
decor_small_20
merchant_lifestyle_20
negative_controls_10
```

### 11.2 Fixture case structure

```text
fixtures/cases/{case_slug}
├── product.png
├── product_cutout.png
├── room.jpg
├── mask.png optional
├── expected.json
└── notes.md
```

### 11.3 Expected JSON

```json
{
  "caseSlug": "lamp-on-side-table-01",
  "category": "lamp",
  "dims": {
    "widthMm": 350,
    "heightMm": 650,
    "depthMm": 350
  },
  "tap": {
    "x": 0.42,
    "y": 0.68
  },
  "mustPreserve": [
    "product shape",
    "shade colour",
    "base material"
  ],
  "mustAvoid": [
    "wrong product",
    "floating object",
    "impossible scale",
    "extra furniture"
  ],
  "humanReviewRequired": true
}
```

### 11.4 Scoring dimensions

```text
product_identity
scale_plausibility
placement_accuracy
lighting_match
perspective_match
shadow_contact
scene_integration
artifact_absence
prompt_compliance
commercial_usefulness
```

### 11.5 Benchmark gates

Before any model, prompt, or recipe receives production traffic:

```text
Runs against shopper_core_15
No catastrophic identity failures
>= 13/15 automated pass
Average manual score >= 7.5 where manual review exists
Cost per accepted render within configured cap
p95 latency within configured cap
No unhandled provider response shape
```

### 11.6 Harness output

```text
out/harness-report.html
out/harness-report.json
out/benchmarks/{run_id}/index.html
```

Report must include:

```text
input product
input cutout
input room
tap marker
output image
provider/model
prompt version
recipe version
params
cost
latency
gate scores
manual review field
baseline comparison
pass/fail badge
```

---

## 12. Database Schema

One clean initial migration. No old schema compatibility.

## 12.1 Merchant and Shopify tables

### `shop`

```text
id uuid pk
shop_domain text unique not null
shop_name text
contact_email text
shopify_shop_id text
offline_access_token_encrypted text
access_scopes text[]
plan text check trial/starter/growth/cancelled
trial_ends_at timestamptz
renders_quota integer
lifestyle_images_quota integer
billing_subscription_id text
billing_status text
room_preview_enabled boolean default true
debug_asset_retention_enabled boolean default false
installed_at timestamptz
uninstalled_at timestamptz
created_at timestamptz
updated_at timestamptz
```

### `session`

```text
id text pk
shop_id uuid fk shop
state text
is_online boolean
scope text
expires_at timestamptz
access_token_encrypted text
created_at timestamptz
updated_at timestamptz
```

### `product_setup`

```text
id uuid pk
shop_id uuid fk shop
shopify_product_gid text
shopify_product_handle text
title text
width_mm integer
height_mm integer
depth_mm integer
category text
material text
colour text
merchant_notes text
primary_image_key text
cutout_key text
prep_status text check none/extracting/awaiting_confirm/ready/failed
enabled boolean default false
created_at timestamptz
updated_at timestamptz
unique(shop_id, shopify_product_gid)
```

### `dimension_suggestion`

```text
id uuid pk
product_setup_id uuid fk product_setup
ai_invocation_id uuid fk ai_invocation nullable
field_name text
suggested_value_json jsonb
evidence_text text
confidence text check low/medium/high
status text check pending/accepted/edited/rejected
accepted_value_json jsonb
created_at timestamptz
resolved_at timestamptz
```

---

## 12.2 AI registry tables

### `ai_provider`

```text
id uuid pk
provider_key text unique not null
display_name text not null
adapter_key text not null
adapter_version text not null
status text check enabled/disabled/degraded
secret_ref text nullable
base_url text nullable
docs_url text nullable
notes text
created_at timestamptz
updated_at timestamptz
```

### `ai_model`

```text
id uuid pk
provider_id uuid fk ai_provider
model_key text not null
display_name text
model_version text nullable
status text check enabled/disabled/deprecated/testing
capabilities_json jsonb not null
default_params_json jsonb default '{}'
limits_json jsonb default '{}'
pricing_json jsonb default '{}'
docs_url text nullable
notes text
created_at timestamptz
updated_at timestamptz
unique(provider_id, model_key, model_version)
```

### `ai_model_task`

```text
id uuid pk
ai_model_id uuid fk ai_model
task_type text not null
enabled boolean default true
created_at timestamptz
unique(ai_model_id, task_type)
```

### `model_route_policy`

```text
id uuid pk
name text not null
surface text
task_type text
status text check draft/active/archived
policy_json jsonb not null
created_at timestamptz
updated_at timestamptz
```

Example `policy_json`:

```json
{
  "primary": [
    {
      "providerKey": "gemini",
      "modelKey": "gemini-3.1-flash-image"
    }
  ],
  "fallbacks": [
    {
      "providerKey": "openai",
      "modelKey": "gpt-image-2",
      "onErrorCodes": ["provider_timeout", "provider_5xx"]
    }
  ],
  "escalation": [
    {
      "providerKey": "gemini",
      "modelKey": "gemini-3-pro-image",
      "onGateFail": true
    }
  ],
  "maxAttempts": 3,
  "maxCostUsd": 0.75,
  "maxLatencyMs": 90000
}
```

---

## 12.3 Prompt control tables

### `prompt_template`

```text
id uuid pk
name text not null
task_type text not null
surface text not null
description text
created_at timestamptz
updated_at timestamptz
```

### `prompt_version`

```text
id uuid pk
prompt_template_id uuid fk prompt_template
version integer not null
status text check draft/review/approved/active/archived
system_instruction text nullable
developer_instruction text nullable
user_prompt_template text not null
negative_prompt_template text nullable
variables_schema_json jsonb default '{}'
output_schema_json jsonb default '{}'
allowed_asset_roles_json jsonb default '[]'
required_asset_order_json jsonb default '[]'
default_params_json jsonb default '{}'
prompt_hash text not null
notes text
created_by text
approved_by text nullable
created_at timestamptz
approved_at timestamptz nullable
unique(prompt_template_id, version)
```

### `prompt_bundle`

```text
id uuid pk
name text not null
surface text not null
description text
created_at timestamptz
updated_at timestamptz
```

### `prompt_bundle_version`

```text
id uuid pk
prompt_bundle_id uuid fk prompt_bundle
version integer not null
status text check draft/review/approved/active/archived
prompt_version_map_json jsonb not null
bundle_hash text not null
notes text
created_by text
approved_by text nullable
created_at timestamptz
approved_at timestamptz nullable
unique(prompt_bundle_id, version)
```

### `render_recipe`

```text
id uuid pk
name text not null
surface text not null
kind text check shopper/lifestyle/demo/test/replay/eval
description text
created_at timestamptz
updated_at timestamptz
```

### `render_recipe_version`

```text
id uuid pk
render_recipe_id uuid fk render_recipe
version integer not null
status text check draft/review/approved/active/archived
prompt_bundle_version_id uuid fk prompt_bundle_version
model_route_policy_id uuid fk model_route_policy
gate_policy_json jsonb not null
retry_policy_json jsonb not null
storage_policy_json jsonb not null
output_policy_json jsonb not null
recipe_hash text not null
notes text
created_by text
approved_by text nullable
created_at timestamptz
approved_at timestamptz nullable
unique(render_recipe_id, version)
```

### `prompt_deployment`

```text
id uuid pk
surface text not null
task_type text nullable
render_recipe_version_id uuid fk render_recipe_version
status text check active/rolled_back/paused
traffic_percent integer default 100
started_at timestamptz
ended_at timestamptz nullable
created_by text
reason text
```

---

## 12.4 Render and invocation tables

### `room_session`

```text
id uuid pk
shop_id uuid fk shop nullable
product_setup_id uuid fk product_setup nullable
source text check widget/demo/merchant_test/eval
room_key text
normalized_room_key text nullable
expires_at timestamptz
created_at timestamptz
last_activity_at timestamptz
```

### `render_request`

Logical render request. One shopper render, merchant lifestyle image, replay, or eval case.

```text
id uuid pk
trace_id text unique not null
shop_id uuid fk shop nullable
room_session_id uuid fk room_session nullable
product_setup_id uuid fk product_setup nullable
source_render_request_id uuid fk render_request nullable
kind text check shopper/lifestyle/demo/test/replay/eval
surface text check widget/admin/founder/demo/cron/system
status text check created/assets_pending/queued/running/evaluating/done/failed/cancelled/expired
tap_x numeric nullable
tap_y numeric nullable
hint_text text nullable
attempt_count integer default 0
selected_result_asset_id uuid nullable
final_gate_score numeric nullable
final_error_code text nullable
final_message text nullable
created_at timestamptz
updated_at timestamptz
completed_at timestamptz nullable
```

### `render_attempt`

One model attempt inside a render request.

```text
id uuid pk
render_request_id uuid fk render_request
attempt_number integer not null
parent_attempt_id uuid fk render_attempt nullable
ai_invocation_id uuid fk ai_invocation nullable
provider_id uuid fk ai_provider nullable
ai_model_id uuid fk ai_model nullable
render_recipe_version_id uuid fk render_recipe_version
prompt_bundle_version_id uuid fk prompt_bundle_version
status text check queued/running/provider_done/stored/evaluated/accepted/rejected/failed/cancelled
reason text nullable
result_asset_id uuid nullable
gate_score numeric nullable
gate_detail_json jsonb default '{}'
latency_ms integer nullable
cost_estimate_usd numeric nullable
error_code text nullable
error_message text nullable
created_at timestamptz
updated_at timestamptz
completed_at timestamptz nullable
```

### `ai_invocation`

Every AI call, including render, cutout, gate, dimension extraction, and personalization.

```text
id uuid pk
trace_id text not null
surface text not null
task_type text not null
provider_id uuid fk ai_provider
ai_model_id uuid fk ai_model
adapter_key text not null
adapter_version text not null
prompt_template_id uuid fk prompt_template nullable
prompt_version_id uuid fk prompt_version nullable
prompt_bundle_version_id uuid fk prompt_bundle_version nullable
render_recipe_version_id uuid fk render_recipe_version nullable
resolved_system_instruction text nullable
resolved_developer_instruction text nullable
resolved_user_prompt text nullable
resolved_negative_prompt text nullable
variables_json jsonb default '{}'
image_inputs_json jsonb default '[]'
params_json jsonb default '{}'
request_json_redacted jsonb default '{}'
response_json_redacted jsonb default '{}'
normalized_result_json jsonb default '{}'
provider_response_id text nullable
finish_reason text nullable
safety_json jsonb default '{}'
usage_json jsonb default '{}'
cost_estimate_usd numeric nullable
latency_ms integer nullable
status text check created/sent/succeeded/failed/cancelled
error_code text nullable
error_message text nullable
retryable boolean default false
idempotency_key text unique
created_at timestamptz
completed_at timestamptz nullable
```

### `render_asset`

```text
id uuid pk
render_request_id uuid fk render_request
render_attempt_id uuid fk render_attempt nullable
ai_invocation_id uuid fk ai_invocation nullable
role text check product_image/product_cutout/room_original/room_normalized/previous_render/mask/provider_output/gate_input/gate_debug/final_output/intermediate/eval_reference
storage_bucket text not null
storage_key text not null
mime_type text
width integer nullable
height integer nullable
sha256 text nullable
bytes integer nullable
retention_expires_at timestamptz nullable
created_at timestamptz
```

### `render_trace_event`

```text
id uuid pk
trace_id text not null
render_request_id uuid fk render_request nullable
render_attempt_id uuid fk render_attempt nullable
ai_invocation_id uuid fk ai_invocation nullable
event_name text not null
event_level text check debug/info/warn/error
message text nullable
props_json jsonb default '{}'
duration_ms integer nullable
created_at timestamptz
```

### `render_feedback`

```text
id uuid pk
render_request_id uuid fk render_request
verdict text check up/down
issue_tag text nullable
comment text nullable
created_at timestamptz
```

### `manual_review`

```text
id uuid pk
render_request_id uuid fk render_request
reviewer text
score integer check score >= 1 and score <= 10
status text check approved/rejected/needs_prompt_work/needs_model_work/needs_asset_work
issue_tags text[]
notes text
created_at timestamptz
```

---

## 12.5 Jobs and events

### `job`

```text
id uuid pk
type text not null
status text check queued/leased/running/succeeded/failed/dead/cancelled
priority integer default 100
payload_json jsonb not null
idempotency_key text unique
lease_owner text nullable
leased_until timestamptz nullable
attempt_count integer default 0
max_attempts integer default 3
last_error_code text nullable
last_error_message text nullable
run_after timestamptz default now()
created_at timestamptz
updated_at timestamptz
completed_at timestamptz nullable
```

### `event_log`

```text
id uuid pk
ts timestamptz default now()
surface text check widget/admin/demo/outreach/billing/system/founder/ai
name text not null
shop_id uuid nullable
prospect_id uuid nullable
render_request_id uuid nullable
product_setup_id uuid nullable
ai_invocation_id uuid nullable
props_json jsonb default '{}'
```

### `audit_log`

```text
id uuid pk
actor text not null
action text not null
entity_type text not null
entity_id uuid nullable
before_json jsonb nullable
after_json jsonb nullable
reason text nullable
created_at timestamptz default now()
```

---

## 12.6 Eval and experiment tables

### `eval_dataset`

```text
id uuid pk
name text unique not null
description text
status text check active/archived
created_at timestamptz
updated_at timestamptz
```

### `eval_case`

```text
id uuid pk
eval_dataset_id uuid fk eval_dataset
case_slug text not null
product_asset_key text
cutout_asset_key text
room_asset_key text
mask_asset_key text nullable
expected_json jsonb default '{}'
notes text
created_at timestamptz
unique(eval_dataset_id, case_slug)
```

### `eval_run`

```text
id uuid pk
eval_dataset_id uuid fk eval_dataset
name text
render_recipe_version_id uuid fk render_recipe_version
model_route_policy_id uuid fk model_route_policy
status text check queued/running/completed/failed/cancelled
summary_json jsonb default '{}'
created_by text
created_at timestamptz
completed_at timestamptz nullable
```

### `eval_result`

```text
id uuid pk
eval_run_id uuid fk eval_run
eval_case_id uuid fk eval_case
render_request_id uuid fk render_request
automated_score_json jsonb default '{}'
manual_score_json jsonb default '{}'
status text check pass/fail/review
created_at timestamptz
```

### `ai_experiment`

```text
id uuid pk
name text not null
type text check prompt_version_test/model_test/recipe_test/gate_threshold_test/fallback_policy_test/parameter_test
surface text not null
status text check draft/running/paused/completed/archived
start_at timestamptz nullable
end_at timestamptz nullable
traffic_percent integer default 0
success_metric text
guardrail_json jsonb default '{}'
created_by text
created_at timestamptz
updated_at timestamptz
```

### `ai_experiment_arm`

```text
id uuid pk
experiment_id uuid fk ai_experiment
name text not null
render_recipe_version_id uuid fk render_recipe_version nullable
ai_model_id uuid fk ai_model nullable
prompt_bundle_version_id uuid fk prompt_bundle_version nullable
params_override_json jsonb default '{}'
traffic_weight integer default 0
status text check active/paused/archived
created_at timestamptz
```

### `ai_experiment_assignment`

```text
id uuid pk
experiment_id uuid fk ai_experiment
arm_id uuid fk ai_experiment_arm
assignment_key text not null
render_request_id uuid fk render_request nullable
created_at timestamptz
unique(experiment_id, assignment_key)
```

---

## 12.7 Billing, usage, growth

### `usage_monthly`

```text
shop_id uuid fk shop
month text
renders_started integer default 0
renders_accepted integer default 0
renders_failed integer default 0
lifestyle_images_used integer default 0
cost_estimate_usd numeric default 0
created_at timestamptz
updated_at timestamptz
primary key(shop_id, month)
```

### `prospect`

```text
id uuid pk
store_domain text unique
store_name text
contact_email text
email_verified boolean default false
owner_name text
hero_product_json jsonb
personalization_line text
score text check A/B/C
status text check queued/demo_built/approved/sent/clicked/trial/customer/rejected/bounced/unsubscribed
demo_slug text unique
demo_expires_at timestamptz
sequence_id text
batch_id text
created_at timestamptz
updated_at timestamptz
```

### `suppression`

```text
email text pk
reason text check unsub/bounce/manual/customer
created_at timestamptz
```

---

## 13. Storage Contract

### 13.1 Buckets

```text
rooms
products
renders
ai-debug
evals
demo-assets
exports
```

### 13.2 Object paths

```text
rooms/{room_session_id}/original.{ext}
rooms/{room_session_id}/normalized.jpg

products/{shop_id}/{product_setup_id}/source.{ext}
products/{shop_id}/{product_setup_id}/cutout-primary.png
products/{shop_id}/{product_setup_id}/cutout-alt-left.png
products/{shop_id}/{product_setup_id}/cutout-alt-right.png

renders/{render_request_id}/attempt-{attempt_number}/provider-output.png
renders/{render_request_id}/attempt-{attempt_number}/intermediate-{n}.png
renders/{render_request_id}/attempt-{attempt_number}/gate-input-product.png
renders/{render_request_id}/attempt-{attempt_number}/gate-input-render.png
renders/{render_request_id}/final.png

ai-debug/{ai_invocation_id}/request.json
ai-debug/{ai_invocation_id}/response.json
ai-debug/{ai_invocation_id}/normalized.json

evals/{eval_dataset}/{case_slug}/product.png
evals/{eval_dataset}/{case_slug}/cutout.png
evals/{eval_dataset}/{case_slug}/room.jpg
evals/{eval_run_id}/report.html
evals/{eval_run_id}/report.json

demo-assets/{prospect_id}/product.png
demo-assets/{prospect_id}/cutout.png
demo-assets/{prospect_id}/render-01.png
demo-assets/{prospect_id}/render-02.png

exports/replay-bundles/{render_request_id}.zip
```

### 13.3 Storage rules

```text
Browser uploads go direct to Supabase signed upload URL.
Server verifies object existence, MIME type, dimensions, and size after upload.
Server never receives shopper image bytes during normal upload.
All storage keys are recorded in render_asset.
All assets get SHA256 hashes where practical.
All generated images are private.
Shopper display uses signed read URLs.
Founder UI uses signed read URLs.
Expired assets are purged by cron.
Purged assets leave metadata records intact.
```

---

## 14. Render Pipeline

### 14.1 Shopper render flow

```text
POST /app-proxy/rooms
→ create room_session
→ create signed upload URL
→ browser uploads room photo
→ POST /app-proxy/rooms/:id/verify
→ verify storage object
→ normalize room image job
→ POST /app-proxy/renders
→ create render_request
→ enqueue render job
→ resolve recipe
→ compile prompt bundle
→ select model via route policy
→ create ai_invocation
→ call provider adapter
→ store provider output
→ run quality gate
→ accept or retry/escalate
→ final result signed
→ widget polls and displays result
```

### 14.2 Attempt policy

Default shopper policy:

```text
attempt 1: primary fast model
if provider error retryable: retry once on same model
if gate fail: escalate to quality model
if second gate fail: fail with gate_rejected
max attempts: 3
```

### 14.3 Failure codes

```text
asset_missing
asset_invalid
room_upload_expired
product_not_ready
quota_exhausted
provider_timeout
provider_rate_limited
provider_5xx
provider_bad_response
provider_safety_block
provider_no_image
gate_rejected
cost_cap_exceeded
latency_cap_exceeded
job_retry_exhausted
unknown_error
```

### 14.4 Gate result

```ts
export type GateResult = {
  pass: boolean;
  score: number;
  detail: {
    productIdentity: number;
    scalePlausibility: number;
    placementAccuracy: number;
    lightingMatch: number;
    perspectiveMatch: number;
    artifactAbsence: number;
    commercialUsefulness: number;
    notes: string;
  };
};
```

Default pass rule:

```text
min(productIdentity, scalePlausibility, placementAccuracy, artifactAbsence) >= 6
mean >= 7
no catastrophic issue tags
```

---

## 15. Shopper Widget

### 15.1 Files

```text
extension/shopify.extension.toml
extension/blocks/room-preview-button.liquid
extension/assets/widget.js
extension/assets/widget.css
extension/snippets/see-it-config.liquid
```

### 15.2 PDP visibility

Show button only when:

```text
shop installed
shop not cancelled
shop quota available
product setup ready
product enabled
theme block enabled
```

### 15.3 Widget states

```text
closed
entry
photo_pick
uploading
placing
waiting
result
refining
error
```

### 15.4 UX copy

Button:

```text
See it in your room
```

Waiting stages:

```text
Reading your room
Matching the light
Placing the product
Checking the result
```

Result dimension text:

```text
Shown true to size: {W} x {H} x {D} cm
```

Gate rejection:

```text
We couldn’t get this one right. Try another photo or retry.
```

### 15.5 Widget rules

```text
No heavy JS until tap.
No fake percentage bar.
Mobile supports camera capture.
Tap marker can be moved.
No resize controls at launch.
No magic eraser at launch.
Scale comes from merchant-confirmed dimensions.
Max 3 refinements.
Friendly generated-image disclosure required.
```

---

## 16. Shopper API

### `POST /app-proxy/rooms`

Request:

```json
{
  "shop": "example.myshopify.com",
  "productGid": "gid://shopify/Product/123",
  "fileName": "room.jpg",
  "mimeType": "image/jpeg"
}
```

Response:

```json
{
  "roomSessionId": "uuid",
  "uploadUrl": "https://...",
  "uploadToken": "...",
  "roomKey": "rooms/{room_session_id}/original.jpg",
  "expiresAt": "..."
}
```

### `POST /app-proxy/rooms/:roomSessionId/verify`

Response:

```json
{
  "ok": true,
  "width": 1600,
  "height": 1200
}
```

### `POST /app-proxy/renders`

Request:

```json
{
  "roomSessionId": "uuid",
  "tap": {
    "x": 0.42,
    "y": 0.68
  }
}
```

Response:

```json
{
  "renderId": "uuid",
  "traceId": "trace-id",
  "status": "queued"
}
```

### `GET /app-proxy/renders/:renderId`

Running:

```json
{
  "status": "running",
  "stage": "Matching the light"
}
```

Done:

```json
{
  "status": "done",
  "resultUrl": "signed-url",
  "dimensionsText": "Shown true to size: 35 x 65 x 35 cm",
  "remainingRefinements": 3
}
```

Failed:

```json
{
  "status": "failed",
  "errorCode": "gate_rejected",
  "message": "We couldn’t get this one right. Try another photo or retry."
}
```

### `POST /app-proxy/renders/:renderId/refine`

Request:

```json
{
  "hint": "Move it slightly left"
}
```

Rules:

```text
hint max 200 chars
max 3 refinements
parent render must be done
new render_request links to source_render_request_id
```

### `POST /app-proxy/renders/:renderId/feedback`

```json
{
  "verdict": "down",
  "issueTag": "wrong_scale"
}
```

### `POST /app-proxy/events`

Accepts widget funnel events.

---

## 17. Merchant App

### 17.1 Route root

```text
/app
```

### 17.2 Pages

```text
/app
/app/onboarding
/app/products
/app/products/[productId]
/app/lifestyle
/app/billing
/app/settings
```

### 17.3 Onboarding flow

```text
OAuth install
→ product sync
→ merchant selects one product
→ app imports title, description, images
→ dimension extraction AI call
→ merchant confirms or edits dimensions
→ cutout generation AI call
→ merchant test room upload
→ merchant test render
→ widget enable toggle
→ theme editor deep link
```

### 17.4 Activation acceptance

```text
first-session merchant render under 5 minutes
install to working PDP button under 10 minutes
merchant can enable one product without support
```

### 17.5 Product setup fields

```text
title
Shopify product link
width cm
height cm
depth cm
category
material
colour
notes
source image preview
cutout preview
enable toggle
regenerate cutout
render test preview
AI trace links for extraction and cutout
```

### 17.6 Lifestyle studio

Release A:

```text
merchant can generate one test lifestyle image from an approved recipe
```

Release B:

```text
preset rooms
batch generation
approval queue
push approved images to Shopify product media
```

---

## 18. Founder Operations Dashboards

## 18.1 Founder home

```text
/founder
```

Shows:

```text
renders today
accepted render rate
gate rejection rate
provider error rate
p50/p95 latency
cost today
cost per accepted render
active prompt deployments
active experiments
shops needing attention
today’s action
```

## 18.2 AI dashboard

```text
/founder/ai
```

Shows:

```text
enabled providers
enabled models
degraded providers
active prompt deployments
active route policies
active experiments
latest benchmark runs
cost by provider/model
failure rate by provider/model
```

## 18.3 Render operations

```text
/founder/renders
```

Shows every render and every attempt.

## 18.4 Quality dashboard

```text
/founder/quality
```

Shows:

```text
gate score histogram
manual review queue
top failure tags
prompt versions with high failure rate
models with high failure rate
model cost vs quality
fixture pass rates
benchmark trends
```

## 18.5 Costs dashboard

```text
/founder/ai/costs
```

Shows:

```text
cost by day
cost by shop
cost by surface
cost by provider
cost by model
cost by prompt version
cost per accepted render
failed render cost
replay/eval cost
forecast month-end spend
```

---

## 19. Founder AI APIs

```text
GET /api/founder/ai/providers
POST /api/founder/ai/providers
PATCH /api/founder/ai/providers/:id

GET /api/founder/ai/models
POST /api/founder/ai/models
PATCH /api/founder/ai/models/:id

GET /api/founder/ai/prompts
POST /api/founder/ai/prompts
GET /api/founder/ai/prompts/:id
POST /api/founder/ai/prompts/:id/versions
POST /api/founder/ai/prompt-versions/:id/approve
POST /api/founder/ai/prompt-versions/:id/archive

GET /api/founder/ai/bundles
POST /api/founder/ai/bundles
POST /api/founder/ai/bundle-versions/:id/approve

GET /api/founder/ai/recipes
POST /api/founder/ai/recipes
POST /api/founder/ai/recipe-versions/:id/approve

GET /api/founder/ai/deployments
POST /api/founder/ai/deployments
POST /api/founder/ai/deployments/:id/rollback
POST /api/founder/ai/deployments/:id/pause

POST /api/founder/ai/test-render
POST /api/founder/ai/benchmark
POST /api/founder/ai/replay

GET /api/founder/renders
GET /api/founder/renders/:id
POST /api/founder/renders/:id/replay
POST /api/founder/renders/:id/manual-review
POST /api/founder/renders/:id/promote-to-fixture

GET /api/founder/evals
POST /api/founder/evals/run
GET /api/founder/evals/:id

GET /api/founder/experiments
POST /api/founder/experiments
PATCH /api/founder/experiments/:id
POST /api/founder/experiments/:id/pause
POST /api/founder/experiments/:id/promote-winner
```

---

## 20. Shopify Auth, Webhooks, and Billing

### 20.1 Files

```text
src/lib/shopify/auth.ts
src/lib/shopify/session.ts
src/lib/shopify/admin.ts
src/lib/shopify/app-proxy.ts
src/lib/shopify/webhooks.ts
src/lib/shopify/billing.ts
src/lib/shopify/media.ts
```

### 20.2 OAuth routes

```text
GET /api/auth/install
GET /api/auth/callback
```

Callback:

```text
verify state/HMAC
exchange code
create/update shop
store encrypted offline token
create session
write event_log
redirect to /app/onboarding
```

### 20.3 Webhooks

```text
POST /api/webhooks/app/uninstalled
POST /api/webhooks/shop/update
POST /api/webhooks/privacy/customers-data-request
POST /api/webhooks/privacy/customers-redact
POST /api/webhooks/privacy/shop-redact
```

### 20.4 Uninstall behavior

```text
verify HMAC
mark shop.uninstalled_at
clear token
disable widget
cancel active jobs for shop
purge active room sessions
apply retention policy to assets
update billing status locally
write event_log
```

### 20.5 App proxy security

```text
verify Shopify app proxy HMAC on every /app-proxy/* route
never trust client shop/product ids without DB lookup
rate limit by shop, IP, and room session
validate product is enabled and ready
validate quota before render job starts
```

---

## 21. Billing and Quotas

### 21.1 Initial plans

```text
Trial: 50 shopper renders, 10 lifestyle images
Starter: $39/mo, 150 shopper renders, 15 lifestyle images
Growth: $79/mo, 600 shopper renders, 50 lifestyle images
```

### 21.2 Usage rules

```text
renders_started increments when render job starts
renders_accepted increments when a render passes gate
renders_failed increments when final status is failed
cost_estimate_usd accumulates all AI invocation costs
lifestyle_images_used increments when lifestyle generation starts
```

### 21.3 Quota behavior

```text
shopper widget hidden if quota exhausted
merchant dashboard shows quota exhaustion
lifestyle generation blocked if lifestyle quota exhausted
founder replay/eval usage tracked separately from merchant quotas
failed renders still count toward AI cost metrics
billing policy determines whether failed renders count against merchant quota
```

---

## 22. Jobs and Cron

### 22.1 Job types

```text
normalize_room
extract_dimensions
generate_cutout
render_request
quality_gate
render_replay
eval_run
lifestyle_generate
push_shopify_media
demo_generate
sync_sender
purge_expired_assets
usage_rollup
daily_digest
```

### 22.2 Cron routes

```text
/api/cron/sweep-jobs
/api/cron/purge-expired
/api/cron/usage-rollup
/api/cron/digest
/api/cron/demo-batch
/api/cron/sync-sender
```

### 22.3 Job safety

```text
all jobs require idempotency_key
leased jobs expire if worker dies
dead jobs appear in founder operations dashboard
retry policy stored per job type
render jobs write trace events on every state transition
```

---

## 23. Security and Privacy

### 23.1 Secrets

```text
API keys only in env or secret manager
DB stores secret_ref only
Founder UI never displays raw secrets
Provider request JSON redacts auth headers and signed URLs
Provider response JSON redacts secrets
```

### 23.2 Shopper data

```text
No shopper account
No shopper email
No saved room gallery
Room photos stored only for operational retention
Generated shopper images expire by retention policy
Privacy policy must disclose temporary image processing and retention
```

### 23.3 Access control

```text
Merchant routes require Shopify embedded app session token
Founder routes require founder auth
App proxy routes require Shopify app proxy HMAC
Cron routes require CRON_SECRET
Internal job routes require service auth
Every query is scoped to shop where applicable
```

---

## 24. Verification Plan

### 24.1 Final verify command

```text
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run test:integration
pnpm run harness:smoke
pnpm run eval:smoke
pnpm run e2e:smoke
```

### 24.2 Unit tests

Required:

```text
env parsing
provider registry
capability resolver
model route policy
provider adapter contract
prompt compiler
prompt variable validation
prompt hash
prompt diff
prompt deployment rollback
AI invocation redaction
cost estimator
render recipe resolver
render orchestrator
job leasing
job retry
storage path builder
signed upload verification
Shopify HMAC
app proxy verification
webhook verification
billing plan mapping
quota guard
gate parser
replay payload builder
eval score parser
experiment assignment
fixture loader
```

### 24.3 Integration tests

Required:

```text
OAuth install creates shop
product sync creates product setup
dimension extraction logs ai_invocation
cutout generation logs ai_invocation
prompt version approval flow
prompt deployment activation
model route selects primary
model route falls back on provider error
render request creates job
render job creates render_attempt
provider response stores output asset
gate failure escalates once
double gate failure returns friendly error
successful render returns signed URL
render detail page shows prompt snapshot
replay creates linked render_request
eval run creates eval results
experiment assigns stable arm
feedback writes render_feedback
privacy webhook returns success
uninstall disables shop and cancels jobs
billing plan status updates quota
```

### 24.4 E2E tests

Required:

```text
merchant install and onboarding happy path
merchant confirms product dimensions
merchant generates first test render
merchant enables widget
shopper uploads room and receives result
shopper gets friendly gate rejection on bad render
shopper submits feedback
founder views render trace
founder views prompt snapshot
founder replays render with different model
founder edits prompt draft and benchmarks it
founder activates prompt deployment
founder rolls back prompt deployment
billing upgrade path
privacy webhook smoke
mobile widget upload/tap/result
desktop modal accessibility
```

### 24.5 Manual gates

```text
15 shopper fixtures run
>= 13 automated pass
human review approves contact sheet
no product identity failures in approved cases
dev store install works
theme editor block works
PDP Lighthouse delta <= 10
widget initial JS target < 30KB
first merchant render under 5 minutes
install to working PDP button under 10 minutes
founder can inspect every AI instruction for a render
founder can replay a render with a different model
founder can roll back active prompt deployment
```

---

## 25. Multi-Agent Codex Execution Plan

Maximum active implementation lanes: 4 plus verifier.

### Agent 1: Integration Lead and Platform

Owns:

```text
repo cleanup
AGENTS.md
package.json
tsconfig
eslint
next config
vercel config
env parser
CI verify
job system
audit log
docs
```

Acceptance:

```text
clean repo
verify green
job table works
no old PromptOps or monorepo ambiguity
```

### Agent 2: Data, Storage, and Security

Owns:

```text
supabase migrations
storage helpers
signed upload
retention purge
Shopify HMAC
webhooks
token encryption
RLS/service boundaries
```

Acceptance:

```text
schema created
storage contract implemented
privacy webhooks tested
upload verification tested
```

### Agent 3: AI Registry, Prompt Control, and Provider Adapters

Owns:

```text
src/lib/ai/**
provider adapters
prompt compiler
model registry
route policy
prompt control APIs
prompt control UI
cost logging
redaction
```

Acceptance:

```text
can register models
can approve prompt versions
can deploy and rollback prompts
all AI calls create ai_invocation
Gemini/OpenAI adapter contract tests pass
custom-http adapter exists
```

### Agent 4: Render Core, Replay, Eval, and Observability

Owns:

```text
src/lib/render/**
render orchestrator
render attempts
gate
trace events
replay
eval datasets
benchmark runner
render operations UI
harness reports
```

Acceptance:

```text
render pipeline works through AI router
render detail page shows full trace
replay works
benchmark suite works
contact sheet generated
```

### Agent 5: Product Surfaces

Owns:

```text
Shopper widget
app proxy routes
merchant onboarding
product setup
lifestyle minimum slice
billing UI
```

Acceptance:

```text
merchant enables one product
shopper completes render
widget hides when ineligible
billing/quota state shown
```

### Agent 6: QA and Release

Owns:

```text
unit tests
integration tests
Playwright
Lighthouse
App Store checklist
release baseline
manual QA scripts
```

Acceptance:

```text
every release phase has explicit verification
launch candidate has zero critical blockers
```

---

## 26. Release Phases

## Phase 0: Source of truth and cleanup

Deliver:

```text
BUILD-SPEC.md committed
AGENTS.md committed
old monorepo deleted
old PromptOps deleted
verify command fixed
source register created
risk register created
```

Exit:

```text
clean rebuild baseline
pnpm verify runs
no stale authority docs
```

## Phase 1: Platform, schema, jobs, storage

Deliver:

```text
initial migration
storage buckets
env contract
job system
event/audit logs
retention purge
Shopify auth skeleton
```

Exit:

```text
schema tests pass
job retry tests pass
storage tests pass
```

## Phase 2: AI registry and Prompt Control Center

Deliver:

```text
ai_provider
ai_model
prompt_template
prompt_version
prompt_bundle
render_recipe
prompt_deployment
founder AI UI
provider adapters
prompt compiler
redaction
cost logging
```

Exit:

```text
founder can view providers/models
founder can create and approve prompt
founder can deploy and rollback prompt
test AI invocation logs full snapshot
```

## Phase 3: Render core, gate, replay, eval

Deliver:

```text
render_request
render_attempt
ai_invocation logging
render_asset
trace events
quality gate
replay
eval datasets
harness report
```

Exit:

```text
15 fixtures run
>= 13 pass
render detail page shows full trace
replay works with alternate model
```

## Phase 4: Shopify merchant and shopper MVP

Deliver:

```text
OAuth install
product sync
dimension extraction
cutout generation
merchant test render
theme app extension
app proxy widget
signed upload
tap/poll/result/refine/feedback
```

Exit:

```text
merchant first render under 5 minutes
working PDP button under 10 minutes
shopper happy path works on dev store
bad render not shown
```

## Phase 5: Billing, privacy, performance, App Store readiness

Deliver:

```text
billing ADR
Shopify billing path
quota enforcement
privacy webhooks
uninstall flow
rate limits
Lighthouse testing
support runbook
App Store checklist
```

Exit:

```text
billing test mode works
privacy webhooks pass
uninstall clears shop state
PDP Lighthouse delta <= 10
```

## Phase 6: Lifestyle, demos, founder ops expansion

Deliver:

```text
lifestyle studio
demo pages
demo factory
founder quality dashboard
founder costs dashboard
outreach sync
daily digest
```

Exit:

```text
approved lifestyle image pushes to Shopify media
demo page renders
founder can operate quality and costs from dashboard
```

---

## 27. Done Definition

The build is done only when all are true:

```text
legacy architecture deleted
verify green
Shopify OAuth works
theme app extension works
app proxy works
merchant can configure one product
shopper widget renders successfully
bad renders are hidden
every AI call creates ai_invocation
every prompt/instruction is visible in founder UI
every render has trace events
every generated image is inspectable during retention
provider adapters are swappable through registry
prompt versions can be approved, deployed, compared, and rolled back
render replay works
eval benchmark suite works
model comparison works
quality gate blocks bad outputs
billing and quotas work
privacy webhooks work
uninstall flow works
PDP performance gate passes
founder AI dashboard works
render operations dashboard works
cost dashboard works
App Store checklist green
no raw secrets shown
no shopper accounts or saved room gallery
```

---

## 28. Codex First Instruction

Use this exact instruction to start the new build:

```text
You are rebuilding See It from a clean baseline.

BUILD-SPEC.md is the source of truth.

Do not hard-code production prompts as TypeScript constants.
Do not call any AI provider directly from product code.
All AI calls must go through src/lib/ai/router.ts.
Every AI call must create an ai_invocation row.
Every render must create render_request, render_attempt, render_asset, and render_trace_event records.
Every prompt, model, provider, route policy, and recipe must be versioned and visible in /founder/ai.
Every generated image must be inspectable in /founder/renders during its retention window.
Render replay and benchmark evaluation are launch-critical, not later polish.
Use durable jobs for render work. Do not rely on Next after() or Vercel waitUntil() for critical image generation.
Use Shopify theme app extensions and one app proxy root.
Use Supabase signed uploads for shopper room photos.
Keep all secrets out of logs, database snapshots, and founder UI.
Run pnpm verify before every merge.
```

[1]: https://nextjs.org/docs/app/api-reference/functions/after "Functions: after | Next.js"
[2]: https://shopify.dev/docs/apps/build/online-store/theme-app-extensions "About theme app extensions"
[3]: https://shopify.dev/docs/apps/build/online-store/app-proxies "About app proxies and dynamic data"
[4]: https://shopify.dev/docs/apps/launch/app-requirements-checklist "Best practices for apps in the Shopify App Store"
[5]: https://shopify.dev/docs/apps/launch/billing "About billing for your app"
[6]: https://shopify.dev/apps/store/security/gdpr-webhooks "Privacy law compliance"
[7]: https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl "JavaScript: Create signed upload URL | Supabase Docs"
[8]: https://ai.google.dev/gemini-api/docs/image-generation "Gemini API  |  Google AI for Developers"
