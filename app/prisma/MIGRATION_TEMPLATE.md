# Migration Template

Use this checklist when creating database migrations.

---

## Migration: [NAME]

### Change Type

- [ ] Add column
- [ ] Modify column
- [ ] Remove column
- [ ] Add table
- [ ] Add index
- [ ] Other: ___

### Deprecation Check

- [ ] Does this replace existing column(s)? Which: ___
- [ ] Old column marked DEPRECATED in schema.prisma?
  ```prisma
  // DEPRECATED(YYYY-MM-DD): Use newColumn instead
  // Migration: 20YYMMDD_migration_name
  // Removal target: YYYY-MM-DD
  oldColumn  String?  @map("old_column")
  ```
- [ ] Backfill script needed? Location: ___
- [ ] Removal date set: ___

### Sync Requirements

- [ ] Monitor schema updated (if table used by monitor)
  - Tables in monitor: Shop, PromptDefinition, PromptVersion, ShopRuntimeConfig, LLMCall, PromptTestRun, PromptAuditLog
- [ ] TypeScript types updated
- [ ] JSON Schema updated (if JSON column)

### Verification

- [ ] `npx prisma migrate dev` succeeds
- [ ] `npm run generate` succeeds
- [ ] `npm run check:consistency` passes
- [ ] `npm run build` in both apps passes

---

## Deprecation Comment Format

When deprecating a column, add a comment in this format:

```prisma
// DEPRECATED(YYYY-MM-DD): Reason for deprecation
// Migration: YYYYMMDD_migration_name (the migration that added the replacement)
// Removal target: YYYY-MM-DD (when this column can be removed)
deprecatedColumn  String?  @map("deprecated_column")
```

The `check:deprecations` script will fail the build if a DEPRECATED comment's date is in the past.

---

## Example: Replacing a Column

### Step 1: Add new column, mark old as deprecated

```prisma
model ProductAsset {
  // DEPRECATED(2024-03-15): Use resolvedFacts instead
  // Migration: 20240215_add_resolved_facts
  // Removal target: 2024-06-15
  placementFields  Json?  @map("placement_fields")

  // NEW: Structured placement data extracted by LLM
  resolvedFacts    Json?  @map("resolved_facts")
}
```

### Step 2: Create backfill script (if needed)

```typescript
// scripts/backfill-resolved-facts.ts
async function backfill() {
  const assets = await prisma.productAsset.findMany({
    where: { resolvedFacts: null, placementFields: { not: null } },
  });

  for (const asset of assets) {
    await prisma.productAsset.update({
      where: { id: asset.id },
      data: { resolvedFacts: transformPlacementToFacts(asset.placementFields) },
    });
  }
}
```

### Step 3: Update all code to use new column

- Search for all usages of `placementFields`
- Update to use `resolvedFacts`
- Update TypeScript types

### Step 4: After removal target date

- Create migration to drop old column
- Remove DEPRECATED comment
- Remove any backfill/migration code
