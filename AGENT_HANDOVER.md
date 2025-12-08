# Agent Handover - See-It App Remediation

## Context for Next Agent

This is a Shopify Remix app located at `/home/user/See-It/app`. A comprehensive audit identified 68 issues documented in `AUDIT_REPORT.md` and `FIX_PLAN.md`.

**Your task:** Fix the critical and high-priority issues in Package A and Package B.

---

## Task Sizing Strategy

Tasks are structured to use **30-60% of context** by:
1. Grouping related fixes together
2. Providing exact file paths and code locations
3. Including specific code changes needed
4. Limiting scope to critical path items only

---

## TASK 1: Security - Remove Exposed Credentials (Priority: IMMEDIATE)

**Files to DELETE from repository:**
```
/home/user/See-It/gcs-credentials-base64.txt
/home/user/See-It/env.txt
/home/user/See-It/postgres_vars.txt
/home/user/See-It/postgres_vars_kv.txt
```

**Update `.gitignore`** - Add these patterns:
```gitignore
# Secrets - NEVER commit
*.credentials*.txt
env.txt
postgres_vars*.txt
**/gcs-key.json
**/*service-account*.json
```

**Actions:**
1. `git rm gcs-credentials-base64.txt env.txt postgres_vars.txt postgres_vars_kv.txt`
2. Edit `.gitignore` to add patterns above
3. Commit with message about security fix

---

## TASK 2: Fix .env.example Database URL

**File:** `/home/user/See-It/.env.example`

**Current (BROKEN):**
```
DATABASE_URL="file:dev.sqlite"
```

**Change to:**
```
DATABASE_URL="postgresql://user:password@localhost:5432/seeit_dev"
```

**Also add missing required vars:**
```env
# Required for product preparation
GEMINI_API_KEY=your-gemini-api-key

# Required for image storage
GOOGLE_CREDENTIALS_JSON=base64-encoded-service-account-json
GCS_BUCKET=see-it-room

# Optional
DISABLE_PREPARE_PROCESSOR=false
SHOPIFY_BILLING_TEST_MODE=true
```

---

## TASK 3: Fix Hardcoded Billing Test Mode

**File:** `/home/user/See-It/app/app/routes/api.billing.jsx`

**Find line ~17:**
```javascript
isTest: true, // TODO: Make this configurable
```

**Replace with:**
```javascript
isTest: process.env.SHOPIFY_BILLING_TEST_MODE !== 'false',
```

---

## TASK 4: Fix CORS - Overly Permissive

**Files to update:**
- `/home/user/See-It/app/app/routes/app-proxy.render.ts`
- `/home/user/See-It/app/app/routes/app-proxy.render.$jobId.ts`
- `/home/user/See-It/app/app/routes/app-proxy.product.prepared.ts`

**Current (INSECURE):**
```typescript
const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
```

**Replace with function:**
```typescript
function getCorsHeaders(shopDomain: string): Record<string, string> {
    return {
        "Access-Control-Allow-Origin": `https://${shopDomain}`,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
}
```

Then update each route to use `getCorsHeaders(session.shop)` instead of hardcoded `CORS_HEADERS`.

---

## TASK 5: Fix Settings Persistence (In-Memory Loss)

**File:** `/home/user/See-It/app/app/routes/api.settings.jsx`

**Problem:** Settings stored in `let cachedSettings = {...}` are lost on restart.

**Solution:** Store settings in Shop table using `settingsJson` field.

**Add to Prisma schema** (`/home/user/See-It/app/prisma/schema.prisma`):
In the Shop model, add:
```prisma
settingsJson  String?   @map("settings_json")
```

**Update api.settings.jsx:**
```javascript
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const DEFAULT_SETTINGS = {
    style_preset: "neutral",
    automation_enabled: false,
    show_quota: false
};

export const loader = async ({ request }) => {
    const { session } = await authenticate.admin(request);

    const shop = await prisma.shop.findUnique({
        where: { shopDomain: session.shop },
        select: { settingsJson: true }
    });

    const settings = shop?.settingsJson
        ? JSON.parse(shop.settingsJson)
        : DEFAULT_SETTINGS;

    return json(settings);
};

export const action = async ({ request }) => {
    const { session } = await authenticate.admin(request);

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
        return json({ error: "invalid_content_type" }, { status: 400 });
    }

    const body = await request.json();
    const settings = {
        style_preset: body.style_preset ?? DEFAULT_SETTINGS.style_preset,
        automation_enabled: body.automation_enabled ?? DEFAULT_SETTINGS.automation_enabled,
        show_quota: body.show_quota ?? DEFAULT_SETTINGS.show_quota
    };

    await prisma.shop.update({
        where: { shopDomain: session.shop },
        data: { settingsJson: JSON.stringify(settings) }
    });

    return json({ ok: true, settings });
};
```

After schema change, run: `npx prisma migrate dev --name add_settings_json`

---

## TASK 6: Fix Quota Race Condition

**File:** `/home/user/See-It/app/app/quota.server.js`

**Find `enforceQuota` function (~line 87):**
```javascript
export async function enforceQuota(shopId, type, count = 1) {
    await checkQuota(shopId, type, count);
    await incrementQuota(shopId, type, count);
    return true;
}
```

**Replace with atomic transaction:**
```javascript
export async function enforceQuota(shopId, type, count = 1) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return await prisma.$transaction(async (tx) => {
        // Get shop quota limits
        const shop = await tx.shop.findUnique({
            where: { id: shopId },
            select: { dailyQuota: true, monthlyQuota: true }
        });

        if (!shop) {
            throw new Error("Shop not found");
        }

        // Get or create today's usage
        let usage = await tx.usageDaily.findFirst({
            where: { shopId, date: today }
        });

        if (!usage) {
            usage = await tx.usageDaily.create({
                data: {
                    shopId,
                    date: today,
                    prepRenders: 0,
                    cleanupRenders: 0,
                    compositeRenders: 0
                }
            });
        }

        // Check quota
        const field = type === 'prep' ? 'prepRenders'
                    : type === 'cleanup' ? 'cleanupRenders'
                    : 'compositeRenders';

        if (usage[field] + count > shop.dailyQuota) {
            const error = new Error("Daily quota exceeded");
            error.code = "QUOTA_EXCEEDED";
            throw error;
        }

        // Increment atomically
        await tx.usageDaily.update({
            where: { id: usage.id },
            data: { [field]: { increment: count } }
        });

        return true;
    });
}
```

---

## TASK 7: Centralize GCS Client (Remove Duplication)

**Create new file:** `/home/user/See-It/app/app/utils/gcs-client.server.ts`

```typescript
import { Storage } from "@google-cloud/storage";

let storageInstance: Storage | null = null;

export function getGcsClient(): Storage {
    if (storageInstance) {
        return storageInstance;
    }

    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        try {
            let jsonString = process.env.GOOGLE_CREDENTIALS_JSON.trim();

            // Remove surrounding quotes if present
            if (jsonString.startsWith('"') && jsonString.endsWith('"')) {
                jsonString = jsonString.slice(1, -1);
            }

            let credentials;
            try {
                // Try base64 decode first
                const decoded = Buffer.from(jsonString, 'base64').toString('utf-8');
                if (decoded.startsWith('{')) {
                    credentials = JSON.parse(decoded);
                } else {
                    credentials = JSON.parse(jsonString);
                }
            } catch {
                // Fall back to direct JSON parse
                credentials = JSON.parse(jsonString);
            }

            storageInstance = new Storage({ credentials });
        } catch (error) {
            console.error('[GCS] Failed to parse credentials:', error);
            storageInstance = new Storage();
        }
    } else {
        storageInstance = new Storage();
    }

    return storageInstance;
}

export const GCS_BUCKET = process.env.GCS_BUCKET || 'see-it-room';
```

**Then update these files to import from the new module:**
- `app/app/services/gemini.server.ts`
- `app/app/services/storage.server.ts`
- `app/app/routes/webhooks.shop.redact.jsx`
- `app/app/routes/healthz.ts`

Replace their local GCS initialization with:
```typescript
import { getGcsClient, GCS_BUCKET } from "../utils/gcs-client.server";
const storage = getGcsClient();
```

---

## Execution Order

1. **TASK 1** - Security (must be first)
2. **TASK 2** - .env.example fix
3. **TASK 3** - Billing test mode
4. **TASK 4** - CORS fix
5. **TASK 7** - GCS centralization (do before 5 & 6)
6. **TASK 5** - Settings persistence
7. **TASK 6** - Quota race condition

---

## Commit Strategy

Make **one commit per task** with clear messages:
- `fix(security): Remove exposed credentials from repository`
- `fix(config): Update .env.example with correct database URL`
- `fix(billing): Make test mode configurable via environment`
- `fix(security): Restrict CORS to shop storefront origin`
- `refactor: Centralize GCS client initialization`
- `fix(data): Persist settings to database instead of memory`
- `fix(quota): Use transaction to prevent race condition`

---

## Verification Checklist

After completing tasks, verify:
- [ ] No `.txt` credential files in repo
- [ ] `.env.example` has PostgreSQL URL
- [ ] `api.billing.jsx` reads from env var
- [ ] CORS headers use shop domain, not `*`
- [ ] Only one GCS initialization in `utils/gcs-client.server.ts`
- [ ] Settings saved to database
- [ ] Quota uses `$transaction`

---

## Files Reference

| Task | Primary File(s) |
|------|-----------------|
| 1 | `.gitignore`, root `.txt` files |
| 2 | `.env.example` |
| 3 | `app/app/routes/api.billing.jsx` |
| 4 | `app/app/routes/app-proxy.*.ts` |
| 5 | `app/app/routes/api.settings.jsx`, `prisma/schema.prisma` |
| 6 | `app/app/quota.server.js` |
| 7 | New `app/app/utils/gcs-client.server.ts` + 4 consumers |

---

**Branch:** `claude/app-diagnostic-report-014jYGyjPXp5hzTpQtXHLuFo`
**Full details:** See `AUDIT_REPORT.md` and `FIX_PLAN.md`
