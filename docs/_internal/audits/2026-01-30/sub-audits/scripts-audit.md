# Scripts, Migrations, and CLI Tools Audit

**Audit Date:** 2026-01-30  
**Auditor:** Automated Codebase Audit  
**Scope:** `app/scripts/`, `see-it-monitor/scripts/`, `app/prisma/seed-prompts.ts`

---

## Executive Summary

The codebase contains **12 scripts** across two directories plus a seed script. Scripts are generally well-designed with good safety patterns including dry-run modes, rollback capabilities, and row count logging. However, there are some inconsistencies in environment loading and a few scripts lack dry-run modes.

### Key Findings

| Category | Status | Notes |
|----------|--------|-------|
| Dry-run modes | ⚠️ Partial | 3/12 scripts have dry-run; data-modifying scripts should all have it |
| Idempotency | ✅ Good | Seed script is idempotent; migrations use Prisma deploy |
| Row count logging | ✅ Good | Most scripts log affected counts |
| Env loading | ⚠️ Inconsistent | Some use shared `db-url.js`, others use Prisma directly |
| Unsafe defaults | ⚠️ Some | `set-unlimited-credits.js` has no confirmation prompt |

---

## Script Inventory

### 1. `app/scripts/` Directory (11 scripts)

#### 1.1 [`backfill-product-type.js`](app/scripts/backfill-product-type.js)

**Purpose:** Backfill `productType` field for existing `ProductAsset` records from Shopify GraphQL API.

**Safety Features:**
- ✅ Logs affected row counts per batch and total
- ✅ Handles missing access tokens gracefully
- ✅ Rate limiting with 500ms delay between batches
- ✅ Batch processing (50 products per API call)
- ❌ **No dry-run mode**
- ❌ **No rollback capability**

**Env Loading:**
```javascript
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
```
Uses Prisma directly - relies on `DATABASE_URL` being set externally.

**Usage:**
```bash
DATABASE_URL="..." node scripts/backfill-product-type.js [shop-domain]
# Or with dotenv:
npx dotenv -e .env.production -- node scripts/backfill-product-type.js [shop-domain]
```

**Recommendation:** Add `--dry-run` flag to preview changes without writing.

---

#### 1.2 [`check-deprecations.ts`](app/scripts/check-deprecations.ts)

**Purpose:** CI check that scans Prisma schemas for `// DEPRECATED(YYYY-MM-DD)` comments and fails if any have expired.

**Safety Features:**
- ✅ Read-only - no data modifications
- ✅ Clear exit codes (0 = pass, 1 = expired found)
- ✅ Scans both main and monitor schemas

**Env Loading:** None required (file-based only).

**Usage:**
```bash
npx tsx scripts/check-deprecations.ts
```

**Status:** ✅ Well-designed CI tool.

---

#### 1.3 [`check-schema-sync.ts`](app/scripts/check-schema-sync.ts)

**Purpose:** Validates that `see-it-monitor` Prisma schema is a valid subset of the main app schema.

**Safety Features:**
- ✅ Read-only - no data modifications
- ✅ Detailed error messages for mismatches
- ✅ Checks models, fields, enums, and column mappings

**Env Loading:** None required (file-based only).

**Usage:**
```bash
npx tsx scripts/check-schema-sync.ts
```

**Status:** ✅ Well-designed CI tool.

---

#### 1.4 [`image-prep-golden-test.ts`](app/scripts/image-prep-golden-test.ts)

**Purpose:** Golden test for image preparation pipeline - validates that `prepareProductImage` produces correct output.

**Safety Features:**
- ✅ Read-only test (no DB modifications)
- ✅ Requires `PHOTOROOM_API_KEY` to run
- ✅ Clear pass/fail output with timing

**Env Loading:**
```javascript
if (!process.env.PHOTOROOM_API_KEY) {
  console.error("PHOTOROOM_API_KEY is required to run golden test");
  process.exit(1);
}
```

**Usage:**
```bash
PHOTOROOM_API_KEY="..." npx tsx scripts/image-prep-golden-test.ts
```

**Status:** ✅ Well-designed test script.

---

#### 1.5 [`inject-version.js`](app/scripts/inject-version.js)

**Purpose:** Injects version from `package.json` into theme extension files before Shopify deployment.

**Safety Features:**
- ✅ Idempotent (regex replacement)
- ✅ Only modifies specific patterns
- ⚠️ No backup of original files

**Env Loading:** None required.

**Usage:**
```bash
node scripts/inject-version.js
```

**Status:** ✅ Simple and safe.

---

#### 1.6 [`measure-latest-render-latency.mjs`](app/scripts/measure-latest-render-latency.mjs)

**Purpose:** Diagnostic tool that prints timing deltas for the most recent composite run.

**Safety Features:**
- ✅ Read-only - no data modifications
- ✅ Uses shared `db-url.js` for connection resolution
- ✅ Outputs JSON for easy parsing

**Env Loading:**
```javascript
import { resolveDatabaseUrl, getSslConfig, logConnectionInfo } from "../lib/db-url.js";
const resolved = resolveDatabaseUrl();
```
✅ Uses shared resolver with Railway/Vercel awareness.

**Usage:**
```bash
DATABASE_URL="..." node scripts/measure-latest-render-latency.mjs
```

**Status:** ✅ Well-designed diagnostic tool.

---

#### 1.7 [`migrate-statuses.js`](app/scripts/migrate-statuses.js) ⭐ Best Practice Example

**Purpose:** Migrate legacy `ProductAsset.status` values to current vocabulary (Phase 7 migration).

**Safety Features:**
- ✅ **`--dry-run` mode** - shows what would change without writing
- ✅ **`--rollback` mode** - reverts changes using report file
- ✅ **Report file generation** - NDJSON log of all changes for rollback
- ✅ **`--unsafe` flag required** for rollback without valid report
- ✅ Logs before/after counts
- ✅ Uses raw SQL (pg) for Windows ARM64 compatibility

**Env Loading:**
```javascript
import { resolveDatabaseUrl, getSslConfig, logConnectionInfo } from '../lib/db-url.js';
// Also loads .env, .env.local, .env.production manually
loadEnvFileIfPresent(path.join(process.cwd(), ".env"), { preferDotenv: args.preferDotenv });
```
✅ Uses shared resolver + manual env file loading.

**Usage:**
```bash
# Dry run
node scripts/migrate-statuses.js --dry-run

# Execute with report
node scripts/migrate-statuses.js --report=./tmp/migration-report.ndjson

# Rollback
node scripts/migrate-statuses.js --rollback --report=./tmp/migration-report.ndjson
```

**Status:** ✅ **Exemplary migration script** - should be used as template for future migrations.

---

#### 1.8 [`railway-migrate.mjs`](app/scripts/railway-migrate.mjs)

**Purpose:** Simple wrapper to run `prisma migrate deploy` on Railway.

**Safety Features:**
- ✅ Uses Prisma's built-in migration system
- ✅ Cross-platform shell handling

**Env Loading:** Relies on Railway environment variables.

**Usage:**
```bash
node scripts/railway-migrate.mjs
```

**Status:** ✅ Simple and appropriate.

---

#### 1.9 [`run-migration.js`](app/scripts/run-migration.js)

**Purpose:** Run Prisma migrations with explicit DATABASE_URL resolution.

**Safety Features:**
- ✅ Uses shared `db-url.js` resolver
- ✅ Logs connection info before running
- ✅ Clear success/failure messages

**Env Loading:**
```javascript
import { resolveDatabaseUrl, logConnectionInfo } from '../lib/db-url.js';
const resolved = resolveDatabaseUrl();
process.env.DATABASE_URL = resolved.url;
```
✅ Uses shared resolver.

**Usage:**
```bash
railway run node scripts/run-migration.js
```

**Status:** ✅ Well-designed.

---

#### 1.10 [`set-unlimited-credits.js`](app/scripts/set-unlimited-credits.js) ⚠️ Needs Improvement

**Purpose:** Give a shop unlimited credits (1M daily, 10M monthly).

**Safety Features:**
- ✅ Logs before/after values
- ✅ Lists available shops if target not found
- ❌ **No dry-run mode**
- ❌ **No confirmation prompt**
- ❌ **No rollback capability**

**Env Loading:**
```javascript
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
```
Uses Prisma directly.

**Usage:**
```bash
DATABASE_URL="..." node scripts/set-unlimited-credits.js bohoem58.myshopify.com
```

**Recommendations:**
1. Add `--dry-run` flag
2. Add confirmation prompt before modifying production data
3. Log original values for manual rollback

---

#### 1.11 [`sync-live-tags.js`](app/scripts/sync-live-tags.js)

**Purpose:** One-time migration to add "see-it-live" tag to products in "live" status.

**Safety Features:**
- ✅ Uses shared `db-url.js` resolver
- ✅ Logs success/failure counts
- ✅ Groups by shop for efficient API calls
- ❌ **No dry-run mode**
- ❌ **No rollback capability**

**Env Loading:**
```javascript
import { resolveDatabaseUrl, getSslConfig, logConnectionInfo } from '../lib/db-url.js';
```
✅ Uses shared resolver.

**Usage:**
```bash
node scripts/sync-live-tags.js
```

**Recommendation:** Add `--dry-run` flag since this modifies Shopify data.

---

### 2. `see-it-monitor/scripts/` Directory (1 script)

#### 2.1 [`prisma-generate.mjs`](see-it-monitor/scripts/prisma-generate.mjs)

**Purpose:** Run `prisma generate` with DATABASE_URL resolution for Vercel builds.

**Safety Features:**
- ✅ Handles Railway internal hosts
- ✅ Cross-platform (Windows/Unix) support
- ✅ Finds local Prisma binary to avoid npx overhead

**Env Loading:**
```javascript
function resolveDatabaseUrlForPrisma() {
  const privateUrl = process.env.DATABASE_URL;
  const publicUrl = process.env.DATABASE_PUBLIC_URL;
  // ... resolution logic
}
```
⚠️ **Duplicates logic from `app/lib/db-url.js`** - should import shared module.

**Usage:**
```bash
node scripts/prisma-generate.mjs
```

**Recommendation:** Import `resolveDatabaseUrl` from shared module instead of duplicating.

---

### 3. Seed Script

#### 3.1 [`app/prisma/seed-prompts.ts`](app/prisma/seed-prompts.ts)

**Purpose:** Seed canonical prompts for the See It Now pipeline (3 LLM prompts).

**Safety Features:**
- ✅ **Idempotent** - checks for existing records before creating
- ✅ **Verification step** - confirms seed was successful
- ✅ Creates SYSTEM tenant for global fallback prompts
- ✅ Creates default `ShopRuntimeConfig` for existing shops
- ✅ Computes template hash for version tracking

**Env Loading:**
```typescript
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
```
Uses Prisma directly.

**Usage:**
```bash
npm run seed:prompts
# or
npx tsx prisma/seed-prompts.ts
```

**Status:** ✅ Well-designed idempotent seed script.

---

## Environment Loading Analysis

### Shared Module: [`app/lib/db-url.js`](app/lib/db-url.js)

This module provides unified DATABASE_URL resolution with:
- Railway internal host detection
- Fallback to `DATABASE_PUBLIC_URL`
- Postgres URL format validation
- Password presence check
- SSL configuration
- Connection pooling settings

**Scripts Using Shared Module:**
| Script | Uses `db-url.js` |
|--------|------------------|
| `measure-latest-render-latency.mjs` | ✅ Yes |
| `migrate-statuses.js` | ✅ Yes |
| `run-migration.js` | ✅ Yes |
| `sync-live-tags.js` | ✅ Yes |
| `backfill-product-type.js` | ❌ No (Prisma direct) |
| `set-unlimited-credits.js` | ❌ No (Prisma direct) |
| `see-it-monitor/prisma-generate.mjs` | ❌ No (duplicates logic) |

**Recommendation:** Standardize all scripts to use `db-url.js` for consistency.

---

## Migration Idempotency Analysis

| Migration Type | Idempotent | Notes |
|----------------|------------|-------|
| Prisma migrations | ✅ Yes | Uses `prisma migrate deploy` which tracks applied migrations |
| `seed-prompts.ts` | ✅ Yes | Checks for existing records before creating |
| `migrate-statuses.js` | ⚠️ Partial | Idempotent for status changes, but rollback requires report file |
| `backfill-product-type.js` | ✅ Yes | Only updates records with `productType: null` |
| `sync-live-tags.js` | ⚠️ Partial | Shopify `tagsAdd` is idempotent, but no local tracking |

---

## Unsafe Defaults Analysis

| Script | Issue | Risk Level |
|--------|-------|------------|
| `set-unlimited-credits.js` | No confirmation prompt | 🔴 High - accidental quota changes |
| `backfill-product-type.js` | No dry-run | 🟡 Medium - writes to DB immediately |
| `sync-live-tags.js` | No dry-run | 🟡 Medium - modifies Shopify data |

---

## Recommendations

### High Priority

1. **Add dry-run to `set-unlimited-credits.js`**
   ```javascript
   const args = parseArgs(process.argv.slice(2));
   if (args.dryRun) {
     console.log(`[DRY RUN] Would update ${shopDomain} to unlimited credits`);
     return;
   }
   ```

2. **Add confirmation prompt to `set-unlimited-credits.js`**
   ```javascript
   const readline = require('readline');
   const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
   const answer = await new Promise(r => rl.question('Confirm? (y/N) ', r));
   if (answer.toLowerCase() !== 'y') process.exit(0);
   ```

3. **Standardize env loading** - Update scripts using Prisma directly to use `db-url.js`:
   - `backfill-product-type.js`
   - `set-unlimited-credits.js`

### Medium Priority

4. **Add dry-run to `backfill-product-type.js`** and `sync-live-tags.js`

5. **Deduplicate `prisma-generate.mjs`** - Import from shared module:
   ```javascript
   import { resolveDatabaseUrl } from '../app/lib/db-url.js';
   ```

6. **Create script template** based on `migrate-statuses.js` for future migrations

### Low Priority

7. **Add `--verbose` flag** to scripts for debugging
8. **Add timing/duration logging** to long-running scripts

---

## Summary Table

| Script | Dry-Run | Rollback | Row Counts | Shared Env | Idempotent |
|--------|---------|----------|------------|------------|------------|
| `backfill-product-type.js` | ❌ | ❌ | ✅ | ❌ | ✅ |
| `check-deprecations.ts` | N/A | N/A | N/A | N/A | ✅ |
| `check-schema-sync.ts` | N/A | N/A | N/A | N/A | ✅ |
| `image-prep-golden-test.ts` | N/A | N/A | N/A | N/A | ✅ |
| `inject-version.js` | N/A | N/A | N/A | N/A | ✅ |
| `measure-latest-render-latency.mjs` | N/A | N/A | N/A | ✅ | ✅ |
| `migrate-statuses.js` | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| `railway-migrate.mjs` | N/A | N/A | N/A | N/A | ✅ |
| `run-migration.js` | N/A | N/A | N/A | ✅ | ✅ |
| `set-unlimited-credits.js` | ❌ | ❌ | ✅ | ❌ | ✅ |
| `sync-live-tags.js` | ❌ | ❌ | ✅ | ✅ | ⚠️ |
| `prisma-generate.mjs` | N/A | N/A | N/A | ❌ | ✅ |
| `seed-prompts.ts` | N/A | N/A | ✅ | ❌ | ✅ |

---

## Appendix: Script Usage Quick Reference

```bash
# CI/CD Scripts (read-only)
npx tsx scripts/check-deprecations.ts
npx tsx scripts/check-schema-sync.ts
npx tsx scripts/image-prep-golden-test.ts

# Deployment Scripts
node scripts/inject-version.js
node scripts/railway-migrate.mjs
node scripts/run-migration.js

# Data Migration Scripts
node scripts/migrate-statuses.js --dry-run
node scripts/migrate-statuses.js --report=./tmp/report.ndjson
node scripts/migrate-statuses.js --rollback --report=./tmp/report.ndjson

# Backfill Scripts
DATABASE_URL="..." node scripts/backfill-product-type.js [shop-domain]
DATABASE_URL="..." node scripts/sync-live-tags.js

# Admin Scripts
DATABASE_URL="..." node scripts/set-unlimited-credits.js shop.myshopify.com

# Diagnostic Scripts
DATABASE_URL="..." node scripts/measure-latest-render-latency.mjs

# Seed Scripts
npm run seed:prompts
```
