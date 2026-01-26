# See It Now — Ultimate Spec Pack (Single Source of Truth)

This folder is the **canonical** end-to-end specification for **See It Now**.

## What "See It Now" is

On a Shopify product page (PDP), a shopper taps a "See it in your home" button, uploads a room photo, and receives **8 AI-generated hero shot visualizations** (V01-V08) of the product placed into their room. The shopper swipes results and can share/download. The feature is delivered via:

- **Theme app extension** (storefront UI)
- **Shopify app proxy** endpoints (`/apps/see-it/...`) for storefront to backend calls
- **Embedded admin app** for merchants to enable/configure See It Now
- **Postgres DB (Prisma)** + **GCS storage**

## Architecture Overview

See It Now uses a **2-LLM pipeline** for prompt generation:

```
┌─────────────────────────────────────────────────────────────────┐
│                    PREPARATION PHASE                            │
│                 (runs during product prep)                      │
├─────────────────────────────────────────────────────────────────┤
│  Product Data + Images                                          │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────┐                                                │
│  │   LLM #1    │  Extractor (gemini-2.5-flash)                 │
│  │             │  → ProductFacts JSON                  │
│  └─────────────┘                                                │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────┐                                                │
│  │  Resolver   │  Merge: extracted + merchantOverrides          │
│  │             │  → resolvedFacts                               │
│  └─────────────┘                                                │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────┐                                                │
│  │   LLM #2    │  Prompt Builder (gemini-2.5-flash)            │
│  │             │  → PlacementSet (8 variants: V01-V08)           │
│  └─────────────┘                                                │
│         │                                                       │
│         ▼                                                       │
│  Store to ProductAsset                                          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      RENDER PHASE                               │
│                (runs on customer request)                       │
├─────────────────────────────────────────────────────────────────┤
│  Request: room_session_id + product_id                          │
│         │                                                       │
│         ▼                                                       │
│  Load: resolvedFacts, placementSet from ProductAsset              │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────┐                                                │
│  │  Assembler  │  GLOBAL_RENDER_STATIC + productDescription        │
│  │             │  + placementInstruction (deterministic)                   │
│  └─────────────┘                                                │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────┐                                                │
│  │  Renderer   │  8 parallel Gemini image calls                 │
│  │             │  (gemini-2.5-flash-image)                      │
│  └─────────────┘                                                │
│         │                                                       │
│         ▼                                                       │
│  Upload to GCS, log to CompositeRun + CompositeVariant               │
└─────────────────────────────────────────────────────────────────┘
```

## Zero-guess build rule

If something is not explicitly specified in this spec pack, it is **out of scope**. A coding agent must not invent behavior.

---

## Canonical Document Map

### Core Specifications

| Doc | File | Purpose |
|-----|------|---------|
| 00 | `00_PRODUCT_SCOPE.md` | Scope, non-goals, definitions, success criteria |
| 01 | `01_USER_FLOWS.md` | Shopper and merchant flows, state machines, edge cases |
| 02 | `02_DESIGN_SYSTEM.md` | Design tokens, typography, colors, buttons, animations |
| 03 | `03_THEME_EXTENSION.md` | Liquid/JS/CSS contracts, DOM IDs, state machine |
| 04 | `04_BACKEND_APP_PROXY_API.md` | Exact API contracts for all storefront routes |
| 05 | `05_ADMIN_APP.md` | Admin UX, internal API, Polaris components |
| 06 | `06_DATABASE_SCHEMA.md` | Prisma schema, field types, indexes, invariants |
| 07 | `07_STORAGE_LAYOUT.md` | GCS key patterns, signed URLs, CORS config |
| 08 | `08_SECURITY_PRIVACY.md` | Auth, tenant isolation, SSRF, rate limiting, privacy |
| 09 | `09_OBSERVABILITY.md` | Logging, request IDs, health checks, metrics |
| 10 | `10_TEST_PLAN.md` | Unit/integration/E2E test matrix, fixtures |
| 11 | `11_DEPLOYMENT.md` | Environment variables, migrations, deploy steps |
| 12 | `12_ACCEPTANCE_CHECKLIST.md` | Definition of done, ship checklist |

### AI and Variant Specifications

| Doc | File | Purpose |
|-----|------|---------|
| 13 | `13_AI_PROMPTS.md` | 2-LLM pipeline, model names, prompt construction |
| 14 | `14_VARIANT_LIBRARY.md` | V01-V08 controlled bracket system |

---

## Reading Order for Agents

If you're a coding agent rebuilding this from scratch, read in this order:

1. **00_PRODUCT_SCOPE.md** — Understand what we're building
2. **01_USER_FLOWS.md** — Understand the user journey
3. **06_DATABASE_SCHEMA.md** — Set up the data layer
4. **07_STORAGE_LAYOUT.md** — Set up GCS
5. **13_AI_PROMPTS.md** — Understand the 2-LLM pipeline
6. **14_VARIANT_LIBRARY.md** — Understand V01-V08 variants
7. **04_BACKEND_APP_PROXY_API.md** — Build the API routes
8. **02_DESIGN_SYSTEM.md** — Learn the visual language
9. **03_THEME_EXTENSION.md** — Build the storefront UI
10. **05_ADMIN_APP.md** — Build the merchant admin
11. **08_SECURITY_PRIVACY.md** — Add security controls
12. **09_OBSERVABILITY.md** — Add logging
13. **10_TEST_PLAN.md** — Write tests
14. **11_DEPLOYMENT.md** — Deploy
15. **12_ACCEPTANCE_CHECKLIST.md** — Verify everything works

---

## Key Technical Decisions

### Models
- **Text Extraction/Building**: `gemini-2.5-flash-preview-05-20` (LLM #1 and #2)
- **Image Generation**: `gemini-2.5-flash-image` (hero shots)
- **Upscale/Enhance**: `gemini-3-pro-image-preview`
- **Background removal**: `@imgly/background-removal-node` (local, not Gemini)

### Variants
- **V01-V08**: 8 controlled probes varying placement and scale
- **Parallel execution**: All 8 variants rendered simultaneously
- **Partial success**: Returns whatever succeeded (1-8 variants)

### Frameworks
- **Backend**: Remix (Shopify app template)
- **Database**: PostgreSQL with Prisma ORM
- **Storage**: Google Cloud Storage
- **Admin UI**: Shopify Polaris
- **Storefront**: Vanilla JS (no framework)

### API Pattern
- All storefront calls via Shopify app proxy (`/apps/see-it/...`)
- HMAC authentication handled by Shopify
- JSON responses only (no HTML error pages)
- 4xx for expected failures, 5xx only for unexpected errors

---

## Key Files

```
app/
├── config/
│   ├── prompts/
│   │   ├── global-render.prompt.ts      # Mandatory render rules
│   │   ├── extractor.prompt.ts          # LLM #1 prompt
│   │   ├── prompt-builder.prompt.ts     # LLM #2 prompt
│   │   ├── variant-intents.config.ts    # V01-V08 definitions
│   │   ├── material-behaviors.config.ts # Material-specific rules
│   │   └── scale-guardrails.config.ts   # Scale templates
│   └── schemas/
│       └── product-facts.schema.ts      # JSON schema
├── services/
│   └── see-it-now/
│       ├── index.ts                     # Exports
│       ├── types.ts                     # TypeScript interfaces
│       ├── extractor.server.ts          # LLM #1
│       ├── resolver.server.ts           # Merge logic
│       ├── prompt-builder.server.ts     # LLM #2
│       ├── prompt-assembler.server.ts   # Deterministic assembly
│       ├── renderer.server.ts           # Parallel Gemini calls
│       ├── monitor.server.ts            # DB logging
│       └── versioning.server.ts         # Prompt version tracking
└── routes/
    ├── app-proxy.see-it-now.render.ts   # /apps/see-it/see-it-now/render
    ├── app.monitor.tsx                  # Admin monitor UI
    └── api.monitor.run.$id.tsx          # Monitor API
```

---

## Spec Versioning

Last updated: January 2025

**Breaking changes in this version:**
- Replaced 10-variant creative library with 8-variant controlled bracket (V01-V08)
- Introduced 2-LLM pipeline (Extractor + Prompt Builder)
- Added CompositeRun and CompositeVariant tables for lineage tracking
- Added PromptVersion table for reproducibility

If you find inconsistencies between spec documents, the higher-numbered document takes precedence (e.g., 13 overrides 14 for prompt details).
