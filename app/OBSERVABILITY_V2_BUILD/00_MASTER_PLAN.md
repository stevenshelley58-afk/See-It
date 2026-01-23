# Observability v2 Build - Master Plan

## Overview

This folder contains sequential build prompts for Claude Code. Execute in order. One session per file. Verify and commit after each.

## Execution Order

| # | File | What It Does | Verify |
|---|------|--------------|--------|
| 01 | 01_DATABASE.md | Schema + migration | `npx prisma migrate dev` succeeds |
| 02 | 02_TELEMETRY_CONSTANTS.md | Types and constants | File exists, TypeScript compiles |
| 03 | 03_TELEMETRY_EMITTER.md | Event emission | Import works |
| 04 | 04_TELEMETRY_ROLLUPS.md | RenderRun/VariantResult writes | Import works |
| 05 | 05_TELEMETRY_ARTIFACTS.md | GCS + index | Import works |
| 06 | 06_TELEMETRY_INDEX.md | Public API barrel | `import { startRun } from '~/services/telemetry'` works |
| 07 | 07_MONITOR_MODULE.md | Read queries | Import works |
| 08 | 08_API_ROUTES.md | v1 API endpoints | Curl returns JSON |
| 09 | 09_UI_RUNS_LIST.md | Runs list page | Page loads at /app/monitor |
| 10 | 10_UI_RUN_DETAIL.md | Run detail page | Page loads, shows variants |
| 11 | 11_UI_HEALTH.md | Health dashboard | Page loads |
| 12 | 12_INSTRUMENTATION.md | Update renderer to use telemetry | Render works, events appear |
| 13 | 13_CLEANUP.md | Delete old files | Build succeeds |

## Rules

1. One session per file
2. Verify before moving to next
3. Commit after each: `git commit -m "observability v2: step XX"`
4. If it fails, fix in same session before moving on

## After All Steps

Run full verification:
- `npm run build` succeeds
- `npm run dev` starts
- Trigger render → appears in monitor within 2s
- Click run → detail shows 8 variants
- Export → ZIP downloads
