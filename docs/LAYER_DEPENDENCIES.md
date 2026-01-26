# Layer Dependencies

Documents the relationships between different layers of the See It codebase.

---

## JSON Columns

### ProductAsset.resolvedFacts

- **TypeScript**: `ProductPlacementFacts` in `app/services/see-it-now/types.ts`
- **Written by**: `prepare-processor.server.ts`, `extractor.server.ts`
- **Read by**: `renderer.server.ts`, `prompt-assembler.server.ts`, PlacementTab.jsx

### ProductAsset.promptPack

- **TypeScript**: `PromptPack` in `app/services/see-it-now/types.ts`
- **Written by**: `prompt-builder.server.ts`
- **Read by**: `renderer.server.ts`

### RenderRun.resolvedConfigSnapshot

- **TypeScript**: `ResolvedConfigSnapshot` in `see-it-monitor/lib/types.ts`
- **Written by**: `prompt-control/resolver.server.ts`
- **Read by**: Monitor dashboard `/runs/[id]`

### RenderRun.waterfallMs

- **TypeScript**: `WaterfallMs` in `see-it-monitor/lib/types.ts`
- **Written by**: `renderer.server.ts`
- **Read by**: Monitor dashboard `/runs/[id]`

### RenderRun.runTotals

- **TypeScript**: `RunTotals` in `see-it-monitor/lib/types.ts`
- **Written by**: `renderer.server.ts`
- **Read by**: Monitor dashboard `/runs/[id]`

### LLMCall.inputPayload

- **TypeScript**: `Record<string, unknown>` (flexible schema)
- **Written by**: `llm-call-tracker.server.ts`
- **Read by**: Monitor dashboard `/runs/[id]/llm-calls`

---

## API Endpoints

### Storefront APIs (snake_case)

| Endpoint | Response Format | Consumer | Source |
|----------|----------------|----------|--------|
| `POST /apps/see-it/room/upload` | snake_case | `see-it-now.js` | `app/routes/app-proxy.room.upload.tsx` |
| `POST /apps/see-it/room/confirm` | snake_case | `see-it-now.js` | `app/routes/app-proxy.room.confirm.tsx` |
| `POST /apps/see-it/see-it-now/render` | snake_case | `see-it-now.js` | `app/routes/app-proxy.see-it-now.render.tsx` |
| `POST /apps/see-it/see-it-now/select` | snake_case | `see-it-now.js` | `app/routes/app-proxy.see-it-now.select.tsx` |

### Monitor APIs (camelCase)

| Endpoint | Response Format | Consumer | Types |
|----------|----------------|----------|-------|
| `GET /external/v1/health` | camelCase | Monitor dashboard | `HealthResponse` |
| `GET /external/v1/runs` | camelCase | Monitor dashboard | `RunsListResponse` |
| `GET /external/v1/runs/:id` | camelCase | Monitor dashboard | `RunDetail` |
| `GET /external/v1/runs/:id/events` | camelCase | Monitor dashboard | `RunEventsResponse` |
| `GET /external/v1/runs/:id/artifacts` | camelCase | Monitor dashboard | `RunArtifactsResponse` |
| `GET /external/v1/runs/:id/llm-calls` | camelCase | Monitor dashboard | `LLMCallsResponse` |
| `GET /external/v1/shops` | camelCase | Monitor dashboard | `ShopsListResponse` |
| `GET /external/v1/shops/:id` | camelCase | Monitor dashboard | `ShopDetail` |

---

## Shared Types

### Types copied between apps

| Type | Source | Destination | Notes |
|------|--------|-------------|-------|
| `WaterfallMs` | `app/services/see-it-now/types.ts` | `see-it-monitor/lib/types.ts` | Waterfall timing breakdown |
| `RunTotals` | `app/services/see-it-now/types.ts` | `see-it-monitor/lib/types.ts` | Aggregated run metrics |
| `VariantResult` | `app/services/monitor/types.ts` | `see-it-monitor/lib/types.ts` | Variant output details |
| `LLMCall` | `app/services/prompt-control/types.ts` | `see-it-monitor/lib/types.ts` | LLM call instrumentation |

### Enums shared between schemas

| Enum | Main Schema | Monitor Schema | Notes |
|------|-------------|----------------|-------|
| `PromptStatus` | `DRAFT`, `ACTIVE`, `ARCHIVED` | Same | Prompt version status |
| `CallStatus` | `STARTED`, `SUCCEEDED`, `FAILED`, `TIMEOUT` | Same | LLM call status |
| `AuditAction` | 7 values | Same | Audit log actions |

---

## Database Schema Relationship

```
app/prisma/schema.prisma (MAIN - source of truth)
         │
         │ subset
         ▼
see-it-monitor/prisma/schema.prisma (MONITOR - read-only)
```

### Models in Monitor Schema

The monitor schema includes only models needed for the Prompt Control Plane and observability:

- `Shop` (minimal fields)
- `PromptDefinition`
- `PromptVersion`
- `ShopRuntimeConfig`
- `LLMCall`
- `PromptTestRun`
- `PromptAuditLog`

### Models NOT in Monitor Schema

These models exist only in the main schema:

- `Session`
- `ProductAsset`
- `RoomSession`
- `RenderJob`
- `UsageDaily`
- `SavedRoomOwner`
- `SavedRoom`
- `SeeItCapture`
- `PrepEvent`
- `PromptConfigVersion`
- `RenderRun`
- `VariantResult`
- `MonitorEvent`
- `MonitorArtifact`

---

## File Dependency Graph

```
Frontend (Storefront)
├── extensions/see-it-extension/assets/see-it-now.js
│   └── Consumes: /apps/see-it/* endpoints (snake_case)
│
Backend (Remix)
├── app/routes/app-proxy.*.tsx
│   └── Serves: Storefront APIs
├── app/routes/external.v1.*.tsx
│   └── Serves: Monitor APIs
├── app/services/see-it-now/types.ts
│   └── Source of truth: ProductPlacementFacts, PromptPack
├── app/services/monitor/types.ts
│   └── Source of truth: RunListItemV1, RunDetailV1
│
Shared Utilities
├── app/utils/cors.server.ts
│   └── Used by: app-proxy routes, external API routes
├── app/utils/image-download.server.ts
│   └── Used by: prepare-processor, gemini services
├── app/utils/cron-auth.server.ts
│   └── Used by: cron routes (cleanup, daily-usage)
│
Monitor App
├── see-it-monitor/lib/types.ts
│   └── Consumes: /external/v1/* endpoints (camelCase)
├── see-it-monitor/prisma/schema.prisma
│   └── Subset of: app/prisma/schema.prisma
```
