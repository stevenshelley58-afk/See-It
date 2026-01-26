# Change Checklist

A reference for developers when making changes across the See It codebase.

---

## Before Making a Change

### Database Schema Changes

- [ ] Is this ADD, MODIFY, or REMOVE?
- [ ] If adding column for same data: mark old column DEPRECATED in schema
- [ ] If JSON column: update TypeScript interface AND JSON Schema
- [ ] Run: `npm run check:consistency` (validates monitor schema subset)

### API Response Changes

- [ ] Which consumers use this endpoint?
  - Storefront JS (`extensions/see-it-extension/assets/see-it-now.js`)
  - Monitor app (`see-it-monitor`)
  - Merchant UI (Remix routes)
- [ ] If storefront: update JSDoc types in `see-it-now.js`
- [ ] If monitor: update `see-it-monitor/lib/types.ts`
- [ ] Add/update contract test in `app/tests/api-contracts/` (optional)

### Type Definition Changes

- [ ] Update source of truth in `app/services/see-it-now/types.ts`
- [ ] Copy to `see-it-monitor/lib/types.ts` if shared
- [ ] If JSON column type: update `config/schemas/*.schema.ts`

---

## After Making a Change

- [ ] Run `npm run build` in both apps
- [ ] Run `npm run check:consistency` (finds schema drift and expired deprecations)
- [ ] Update `docs/LAYER_DEPENDENCIES.md` if new dependencies created

---

## Change Type Quick Reference

### Adding a New Field to CompositeRun

1. Add field to `app/prisma/schema.prisma` (CompositeRun model)
2. Add field to `see-it-monitor/prisma/schema.prisma` if monitor reads it
3. Create migration: `npm run migrate:dev`
4. Update TypeScript types in `app/services/monitor/types.ts`
5. Update `see-it-monitor/lib/types.ts` if exposed to monitor UI
6. Run `npm run check:consistency`

### Adding a New API Endpoint

1. Create route in `app/routes/`
2. Define response type in route file or shared types
3. If consumed by storefront: add JSDoc types to `see-it-now.js`
4. If consumed by monitor: add types to `see-it-monitor/lib/types.ts`
5. Update `docs/LAYER_DEPENDENCIES.md`

### Modifying JSON Column Shape

1. Update TypeScript interface in source file
2. Update JSON Schema if one exists
3. Write migration to backfill existing rows (if needed)
4. Update all readers/writers of that column
5. Run `npm run build` in both apps to catch type errors

---

## Common Pitfalls

### Snake Case vs Camel Case

- **Storefront API** (`/apps/see-it/*`): snake_case responses
- **Monitor API** (`/external/v1/*`): camelCase responses
- **Database columns**: snake_case (via Prisma `@map`)
- **TypeScript interfaces**: camelCase

### Prisma Schema Sync

The monitor app has a **subset** of the main schema. When adding:
- New models: Only add to monitor if it needs to read them
- New fields on existing models: Add to both if monitor reads them
- New enums: Add to both if used by shared models

### Type Drift Detection

The `check:consistency` script catches:
- Models in monitor schema missing from main schema
- Enum values in monitor not present in main
- DEPRECATED comments past their expiration date
