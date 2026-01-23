# Observability v2 - Execution Guide

## How to Use These Prompts

Each `.md` file in this folder is a self-contained prompt for Claude Code.

### Execution Steps

1. Open Claude Code
2. Set the working directory to `C:\See It\app`
3. Copy the contents of the next `.md` file
4. Paste into Claude Code
5. Let it execute
6. Verify the result (see verification section in each file)
7. If verification passes, commit: `git commit -m "observability v2: step XX"`
8. Move to next file

### Order

Execute in numerical order:
1. 01_DATABASE.md
2. 02_TELEMETRY_CONSTANTS.md
3. 03_TELEMETRY_EMITTER.md
4. 04_TELEMETRY_ROLLUPS.md
5. 05_TELEMETRY_ARTIFACTS.md
6. 06_TELEMETRY_INDEX.md
7. 07_MONITOR_MODULE.md
8. 08_API_ROUTES.md
9. 09_UI_RUNS_LIST.md
10. 10_UI_RUN_DETAIL.md
11. 11_UI_HEALTH.md
12. 12_INSTRUMENTATION.md
13. 13_CLEANUP.md

### If Something Fails

Stay in the same Claude Code session and fix it before moving on.

Common issues:
- Missing import → Add the import
- Type error → Check the types.ts file
- Prisma error → Run `npx prisma generate`
- Build error → Check for typos in file paths

### Final Verification

After all steps, run this checklist:

```bash
# Build
npm run build

# Type check  
npx tsc --noEmit

# Start
npm run dev
```

Then manually test:
1. Go to `/app/monitor` - runs list loads
2. Go to `/app/monitor/health` - health stats load
3. Trigger a render - run appears in list
4. Click run - detail page shows variants
5. Click Export - ZIP downloads
6. Check DB - `monitor_events` has records

### File Structure After Completion

```
app/services/
├── telemetry/
│   ├── index.ts
│   ├── constants.ts
│   ├── types.ts
│   ├── emitter.server.ts
│   ├── rollups.server.ts
│   └── artifacts.server.ts
├── monitor/
│   ├── index.ts
│   ├── types.ts
│   └── queries.server.ts
└── see-it-now/
    ├── index.ts (modified)
    ├── renderer.server.ts (modified)
    └── [unchanged files]

app/routes/
├── api.monitor.v1.runs.tsx
├── api.monitor.v1.runs.$id.tsx
├── api.monitor.v1.runs.$id.events.tsx
├── api.monitor.v1.runs.$id.artifacts.tsx
├── api.monitor.v1.runs.$id.export.tsx
├── api.monitor.v1.health.tsx
├── app.monitor._index.tsx
├── app.monitor.$id.tsx
├── app.monitor.health.tsx
└── app-proxy.see-it-now.render.ts (modified)

DELETED:
- app/services/see-it-now/monitor.server.ts
- app/routes/app.monitor.tsx
- app/routes/api.monitor.run.$id.tsx
```

### Dependencies Added

Step 08 adds:
- archiver
- @types/archiver

Run: `npm install archiver && npm install -D @types/archiver`
