# See It App — Status System Overhaul

## Complete Specification & Implementation Guide

**Purpose:** This document provides everything needed for an AI coding agent to completely overhaul the status system across the See It Shopify app. The goal is to replace the current confusing, broken status system with a clean, simple, user-centric approach.

---

## 1. CURRENT STATE (What We're Replacing)

### Current ProductAsset.status Values (BROKEN)
```
"pending" | "processing" | "ready" | "failed" | "stale" | "orphaned"
```

### Problems with Current System
1. **"pending" is overloaded** — No asset row AND status="pending" both show same UI
2. **"ready" doesn't mean ready** — Product can be "ready" but not actually usable
3. **No "enabled" concept** — No way to know if merchant wants it live on storefront
4. **Dead statuses** — "stale" and "orphaned" exist but are never used
5. **Confusing terminology** — "ready" vs "completed" in different tables
6. **No placement prompt generation** — Prep only does BG removal, not prompt

### Current RenderJob.status Values (KEEP AS-IS)
```
"queued" | "processing" | "completed" | "failed"
```
This is fine — it's job queue status, separate from product setup status.

---

## 2. NEW STATUS SYSTEM

### New ProductAsset.status Values
```
"unprepared" | "preparing" | "ready" | "live" | "failed"
```

| Status | Meaning | See It Button Shows? | UI Badge |
|--------|---------|---------------------|----------|
| `unprepared` | Product synced, never touched | No | "Not Prepared" (gray) |
| `preparing` | AI working (BG removal + prompt generation) | No | "Preparing..." (amber, animated) |
| `ready` | Prep done, merchant hasn't enabled yet | No | "Ready" (blue) |
| `live` | Merchant enabled, customers can use it | **Yes** | "Live" (green) |
| `failed` | Preparation failed | No | "Failed" (red) |

### New Field: `enabled` (Boolean)
Add a new field `enabled` (Boolean, default false) to ProductAsset. This controls the ready ↔ live transition.

### Status Flow
```
unprepared → preparing → ready ⇄ live
                  ↘ failed
```

### Transitions
| Action | From | To |
|--------|------|-----|
| Click "Prepare" | unprepared | preparing |
| AI prep succeeds (BG removal + prompt) | preparing | ready |
| AI prep fails after retries | preparing | failed |
| Merchant enables toggle + saves | ready | live |
| Merchant disables toggle + saves | live | ready |
| Click "Retry" | failed | preparing |
| Edit while live + save | live | live (stays live) |
| Edit while ready + save | ready | ready (stays ready) |

---

## 3. WHAT "PREPARING" NOW DOES

The `preparing` status now encompasses a **combined single step** that does:

1. **Background Removal** — AI removes background, creates transparent PNG cutout
2. **Auto-Generate Placement Prompt** — AI analyzes product image + title/description → writes renderInstructions
3. **Auto-Set Scene Role** — AI detects: floor furniture, wall art, tabletop decor, etc.
4. **Auto-Set Replacement Rule** — AI sets smart defaults for replacementRule, allowSpaceCreation

When ALL of these complete successfully → status becomes `ready` (not `live`).

The merchant then reviews and clicks "Enable" to go `live`.

---

## 4. DATABASE CHANGES

### Schema Changes (prisma/schema.prisma)

```prisma
model ProductAsset {
  // ... existing fields ...
  
  // CHANGE: Update status comment to reflect new values
  status             String // "unprepared" | "preparing" | "ready" | "live" | "failed"
  
  // ADD: New field for enable/disable control
  enabled            Boolean  @default(false) @map("enabled")
  
  // ... rest of existing fields ...
}
```

### Migration Script

```sql
-- Step 1: Add the new 'enabled' column
ALTER TABLE product_assets ADD COLUMN enabled BOOLEAN DEFAULT false;

-- Step 2: Migrate existing statuses
-- "ready" with prepared image → "ready" (merchant needs to enable)
-- "ready" without prepared image → "unprepared" 
-- "pending" → "unprepared" (if no processing started) OR "preparing" (if was in queue)
-- "processing" → "preparing"
-- "failed" → "failed" (no change)
-- "stale" → "unprepared" (reset, let them re-prepare)
-- "orphaned" → "unprepared" (reset)

UPDATE product_assets 
SET status = 'ready', enabled = false 
WHERE status = 'ready' AND prepared_image_url IS NOT NULL;

UPDATE product_assets 
SET status = 'unprepared', enabled = false 
WHERE status = 'ready' AND prepared_image_url IS NULL;

UPDATE product_assets 
SET status = 'preparing', enabled = false 
WHERE status IN ('pending', 'processing');

UPDATE product_assets 
SET status = 'unprepared', enabled = false 
WHERE status IN ('stale', 'orphaned');

-- Step 3: For products that were "ready" with a prepared image AND have renderInstructions,
-- we could consider them ready for the merchant to enable.
-- They stay as "ready" - merchant must explicitly enable.
```

---

## 5. FILES TO MODIFY

### Core Files

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Update status comment, add `enabled` field |
| `app/services/prepare-processor.server.ts` | Add prompt generation step, update status transitions |
| `app/services/description-writer.server.ts` | May need updates for auto-prompt generation |
| `app/routes/api.products.prepare.jsx` | Create asset with status="preparing" |
| `app/routes/api.products.batch-prepare.jsx` | Create assets with status="preparing" |
| `app/routes/api.products.update-instructions.jsx` | Handle enabled flag updates |
| `app/routes/app.products.jsx` | Update UI badges, status counts, filters |
| `app/routes/app._index.jsx` | Update dashboard status counts |
| `app/components/ProductDetailPanel.jsx` | Add "Enable for customers" toggle |
| `app/components/ProductDetailPanel/PrepareTab.jsx` | Update status display |
| `app/components/ProductDetailPanel/PlacementTab.jsx` | Add enable toggle at bottom |

### Storefront Files

| File | Changes |
|------|---------|
| `app/routes/app-proxy.product.prepared.ts` | Check for status="live" (not "ready") |
| `app/routes/app-proxy.render.ts` | Check for status="live" before allowing render |
| `app/routes/app-proxy.see-it-now.render.ts` | Check for status="live" before allowing render |
| `extensions/see-it-extension/assets/see-it-modal.js` | No changes needed (checks server response) |
| `extensions/see-it-extension/blocks/*.liquid` | No changes needed |

### Webhook/Background Files

| File | Changes |
|------|---------|
| `app/routes/webhooks.products.update.jsx` | Update any status handling logic |

---

## 6. DETAILED IMPLEMENTATION

### 6.1 prepare-processor.server.ts

**Current behavior:**
- Picks up status="pending" assets
- Sets status="processing" while working
- Does BG removal only
- Sets status="ready" on success

**New behavior:**
- Picks up status="preparing" assets (rename from pending)
- Does BG removal
- **NEW:** Calls AI to generate placement prompt (renderInstructions)
- **NEW:** Calls AI to auto-detect sceneRole, replacementRule, allowSpaceCreation
- Sets status="ready" on success (merchant still needs to enable)
- Sets enabled=false (merchant must explicitly enable)

```typescript
// In processPendingAssets function:

// CHANGE: Query for "preparing" instead of "pending"
const pendingAssets = await prisma.productAsset.findMany({
    where: {
        status: "preparing",  // CHANGED from "pending"
        retryCount: { lt: MAX_RETRY_ATTEMPTS }
    },
    take: 5,
    orderBy: { createdAt: "asc" }
});

// After successful BG removal, ADD prompt generation:
if (success && prepareResult) {
    // Existing: extract metadata
    let renderInstructions = asset.renderInstructions;
    let sceneRole = asset.sceneRole;
    let replacementRule = asset.replacementRule;
    let allowSpaceCreation = asset.allowSpaceCreation;
    
    // NEW: Auto-generate placement config if not already set
    if (!renderInstructions) {
        try {
            const placementConfig = await generatePlacementConfig(
                asset.sourceImageUrl,
                asset.productTitle || '',
                itemRequestId
            );
            
            if (placementConfig) {
                renderInstructions = placementConfig.renderInstructions;
                sceneRole = placementConfig.sceneRole || sceneRole;
                replacementRule = placementConfig.replacementRule || replacementRule;
                allowSpaceCreation = placementConfig.allowSpaceCreation ?? allowSpaceCreation;
            }
        } catch (promptError) {
            logger.warn(
                createLogContext("prepare", itemRequestId, "prompt-generation", { error: promptError instanceof Error ? promptError.message : String(promptError) }),
                "Prompt generation failed, continuing without",
                promptError
            );
        }
    }

    // CHANGE: Set status to "ready" (not "live"), enabled=false
    await prisma.productAsset.update({
        where: { id: asset.id },
        data: {
            status: "ready",  // CHANGED: was "ready", stays "ready" but meaning changed
            enabled: false,   // NEW: merchant must enable
            preparedImageUrl: prepareResult.url,
            preparedImageKey: preparedImageKey,
            renderInstructions: renderInstructions,
            sceneRole: sceneRole,
            replacementRule: replacementRule,
            allowSpaceCreation: allowSpaceCreation,
            geminiFileUri: prepareResult.geminiFileUri,
            geminiFileExpiresAt: prepareResult.geminiFileExpiresAt,
            retryCount: 0,
            errorMessage: null,
            updatedAt: new Date()
        }
    });
}

// CHANGE: Update failure handling
await prisma.productAsset.update({
    where: { id: asset.id },
    data: {
        status: isFinalFailure ? "failed" : "preparing",  // CHANGED from "pending"
        errorMessage: errorMessage.substring(0, 500),
        retryCount: newRetryCount,
        updatedAt: new Date()
    }
});
```

### 6.2 NEW: generatePlacementConfig Function

Add this new function to generate placement prompts automatically:

```typescript
// Add to prepare-processor.server.ts or create new file

import { GoogleGenerativeAI } from "@google/generative-ai";

interface PlacementConfig {
    renderInstructions: string;
    sceneRole: string | null;
    replacementRule: string | null;
    allowSpaceCreation: boolean | null;
}

async function generatePlacementConfig(
    imageUrl: string,
    productTitle: string,
    requestId: string
): Promise<PlacementConfig | null> {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    // Fetch the image
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');
    const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';

    const prompt = `You are analyzing a product image for an AR/visualization app that places furniture and home decor into customer room photos.

Product Title: "${productTitle}"

Analyze this product image and provide:

1. **renderInstructions**: A detailed description for AI image generation. Include:
   - What the product is (material, style, color)
   - How it should be placed in a room (on floor, on wall, on table, etc.)
   - Scale/proportion guidance
   - Any special placement considerations
   - Example: "A solid teak wood dining table with natural grain and tapered legs. Place on floor as main furniture piece. Scale to realistic dining table proportions (approximately 72 inches long). Ensure all four legs contact the floor naturally. The warm wood tone should complement various room styles."

2. **sceneRole**: One of:
   - "floor_furniture" (sofas, tables, chairs, rugs)
   - "wall_art" (paintings, mirrors, wall decor)
   - "tabletop" (vases, lamps, small decor)
   - "lighting" (floor lamps, pendant lights)
   - "outdoor" (garden furniture, planters)

3. **replacementRule**: One of:
   - "replace_similar" (replace similar items in the room)
   - "add_to_scene" (add without replacing anything)
   - "replace_any" (can replace any blocking object)

4. **allowSpaceCreation**: true if the AI can create minimal space/context around the product, false if it should only place in existing space.

Respond in JSON format only:
{
    "renderInstructions": "...",
    "sceneRole": "...",
    "replacementRule": "...",
    "allowSpaceCreation": true/false
}`;

    try {
        const result = await model.generateContent([
            { text: prompt },
            {
                inlineData: {
                    mimeType: mimeType,
                    data: base64Image
                }
            }
        ]);

        const responseText = result.response.text();
        
        // Extract JSON from response (handle markdown code blocks)
        let jsonStr = responseText;
        const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
            jsonStr = jsonMatch[1];
        } else {
            // Try to find raw JSON
            const rawJsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (rawJsonMatch) {
                jsonStr = rawJsonMatch[0];
            }
        }

        const config = JSON.parse(jsonStr);
        
        logger.info(
            createLogContext("prepare", requestId, "placement-config-generated", {
                sceneRole: config.sceneRole,
                hasInstructions: !!config.renderInstructions
            }),
            `Auto-generated placement config for product`
        );

        return {
            renderInstructions: config.renderInstructions || null,
            sceneRole: config.sceneRole || null,
            replacementRule: config.replacementRule || null,
            allowSpaceCreation: config.allowSpaceCreation ?? true
        };
    } catch (error) {
        logger.error(
            createLogContext("prepare", requestId, "placement-config-error", {}),
            "Failed to generate placement config",
            error
        );
        return null;
    }
}
```

### 6.3 api.products.prepare.jsx

Update to create assets with status="preparing":

```javascript
// CHANGE: Create asset with status="preparing" instead of "pending"
const asset = await prisma.productAsset.upsert({
    where: {
        // ... existing where clause
    },
    update: {
        status: "preparing",  // CHANGED from "pending"
        enabled: false,       // NEW
        retryCount: 0,
        errorMessage: null,
        updatedAt: new Date()
    },
    create: {
        // ... existing create fields
        status: "preparing",  // CHANGED from "pending"
        enabled: false,       // NEW
        // ...
    }
});
```

### 6.4 api.products.update-instructions.jsx

Add handling for the `enabled` field:

```javascript
export const action = async ({ request }) => {
    // ... existing auth and validation ...

    const formData = await request.formData();
    const productId = formData.get("productId");
    const instructions = formData.get("instructions");
    const enabled = formData.get("enabled"); // NEW: "true" or "false" string
    
    // ... existing logic ...

    const updateData = {
        renderInstructions: instructions,
        // ... other existing fields ...
    };

    // NEW: Handle enabled toggle
    if (enabled !== null) {
        const isEnabled = enabled === "true";
        updateData.enabled = isEnabled;
        
        // Update status based on enabled flag
        if (isEnabled && asset.status === "ready") {
            updateData.status = "live";
        } else if (!isEnabled && asset.status === "live") {
            updateData.status = "ready";
        }
    }

    await prisma.productAsset.update({
        where: { id: asset.id },
        data: updateData
    });

    // ...
};
```

### 6.5 app.products.jsx (Products List Page)

Update status badges and counts:

```javascript
// CHANGE: Status counts query grouping
const statusCounts = { unprepared: 0, preparing: 0, ready: 0, live: 0, failed: 0 };
statusGroups.forEach(g => { statusCounts[g.status] = g._count.status; });

// CHANGE: Status badge rendering in table
const getStatusBadge = (status, enabled) => {
    const badges = {
        unprepared: { label: 'Not Prepared', bg: 'bg-neutral-100', text: 'text-neutral-600', border: 'border-neutral-200', dot: 'bg-neutral-400' },
        preparing: { label: 'Preparing...', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500 animate-pulse' },
        ready: { label: 'Ready', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500' },
        live: { label: 'Live', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
        failed: { label: 'Failed', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', dot: 'bg-red-500' }
    };
    
    const badge = badges[status] || badges.unprepared;
    
    return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${badge.bg} ${badge.text} ${badge.border}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`}></span>
            {badge.label}
        </span>
    );
};

// In the table row:
<td className="px-3 md:px-4 py-2.5 md:py-3">
    {getStatusBadge(asset?.status || 'unprepared', asset?.enabled)}
</td>
```

### 6.6 ProductDetailPanel Components

**PlacementTab.jsx** — Add Enable Toggle:

```jsx
// At the bottom of PlacementTab, add:

<div className="mt-6 pt-6 border-t border-neutral-200">
    <div className="flex items-center justify-between">
        <div>
            <h3 className="text-sm font-medium text-neutral-900">Enable for customers</h3>
            <p className="text-xs text-neutral-500 mt-0.5">
                Show "See It In Your Space" button on your store
            </p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
            <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="sr-only peer"
            />
            <div className="w-11 h-6 bg-neutral-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-neutral-900/10 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
        </label>
    </div>
    
    {/* Status indicator */}
    {enabled ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-emerald-600">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            Customers can see this product in their space
        </div>
    ) : (
        <div className="mt-3 flex items-center gap-2 text-sm text-neutral-500">
            <span className="w-2 h-2 rounded-full bg-neutral-300"></span>
            Enable to show on your store
        </div>
    )}
</div>
```

### 6.7 Storefront Check (app-proxy.product.prepared.ts)

**CRITICAL:** Change the storefront check from "ready" to "live":

```typescript
// CHANGE: Only return prepared assets for "live" products
const productAsset = await prisma.productAsset.findFirst({
    where: {
        shopId: shop.id,
        productId: productId,
        status: "live",    // CHANGED from "ready"
        enabled: true      // NEW: double-check enabled flag
    },
    orderBy: { updatedAt: 'desc' }
});
```

### 6.8 app-proxy.render.ts

Add check for "live" status before allowing render:

```typescript
// After getting productAsset, ADD check:
if (productAsset && productAsset.status !== "live") {
    await prisma.renderJob.update({
        where: { id: job.id },
        data: { status: "failed", errorMessage: "Product not enabled for See It" }
    });
    return json({ 
        job_id: job.id, 
        status: "failed", 
        error: "product_not_enabled",
        message: "This product is not enabled for See It visualization"
    }, { headers: corsHeaders });
}
```

---

## 7. UI/UX SPECIFICATIONS

### Products Table Status Column

| Status | Badge Color | Dot | Label |
|--------|-------------|-----|-------|
| unprepared | Gray bg | Gray dot | "Not Prepared" |
| preparing | Amber bg | Amber dot (animated pulse) | "Preparing..." |
| ready | Blue bg | Blue dot | "Ready" |
| live | Green bg | Green dot | "Live" |
| failed | Red bg | Red dot | "Failed" |

### Dashboard Metrics

Show 4 key counts:
1. **Live** (green) — Products customers can use
2. **Ready** (blue) — Prepared but not enabled
3. **Preparing** (amber) — Currently processing
4. **Failed** (red) — Need attention

### Product Detail Modal

- **Prepare Image tab**: Shows cutout preview, status
- **Placement tab**: Shows auto-generated prompt (editable), scene settings, AND the "Enable for customers" toggle at the bottom
- The toggle should be prominent and clearly explain what it does

---

## 8. TESTING CHECKLIST

After implementation, verify:

### Status Transitions
- [ ] New product shows "Not Prepared" (unprepared)
- [ ] Click Prepare → shows "Preparing..." (preparing)
- [ ] After AI completes → shows "Ready" (ready)
- [ ] Enable toggle ON + Save → shows "Live" (live)
- [ ] Enable toggle OFF + Save → shows "Ready" (ready)
- [ ] Failed prep → shows "Failed" (failed)
- [ ] Retry from failed → shows "Preparing..." (preparing)

### Storefront
- [ ] "unprepared" products: No See It button
- [ ] "preparing" products: No See It button
- [ ] "ready" products: No See It button (not enabled!)
- [ ] "live" products: See It button appears
- [ ] "failed" products: No See It button

### Auto-Generated Prompts
- [ ] After prep completes, renderInstructions is populated
- [ ] sceneRole is auto-detected
- [ ] replacementRule is auto-detected
- [ ] Merchant can edit the auto-generated prompt

### Migration
- [ ] Existing "ready" products → "ready" (not auto-live, merchant must enable)
- [ ] Existing "pending"/"processing" → "preparing"
- [ ] Existing "failed" → "failed"
- [ ] Existing "stale"/"orphaned" → "unprepared"

---

## 9. ROLLBACK PLAN

If issues arise:

```sql
-- Rollback migration
UPDATE product_assets SET status = 'ready' WHERE status = 'live';
UPDATE product_assets SET status = 'pending' WHERE status IN ('unprepared', 'preparing');
ALTER TABLE product_assets DROP COLUMN IF EXISTS enabled;
```

---

## 10. MONITOR INTEGRATION

The See It Monitor tracks product preparation events via the `emitPrepEvent()` function in `app/services/prep-events.server.ts`. This sends events to both:
1. App DB (`prep_events` table) — source of truth
2. Monitor API (`/api/prep/events`) — for dashboards/alerts

### Current Event Types Being Emitted
- `auto_cutout_created` — BG removal succeeded
- `auto_cutout_failed` — BG removal failed
- `auto_metadata_extracted` — AI metadata extraction succeeded
- `prep_confirmed` — Preparation completed (status → ready)

### New Event Types to Add

With the new status system, add these event types:

| Event Type | When | Payload |
|------------|------|---------|
| `status_changed` | Any status transition | `{ from: "unprepared", to: "preparing", trigger: "user_click" }` |
| `placement_config_generated` | AI generates prompt | `{ sceneRole, replacementRule, hasInstructions: true }` |
| `product_enabled` | Merchant enables toggle | `{ enabled: true, status: "live" }` |
| `product_disabled` | Merchant disables toggle | `{ enabled: false, status: "ready" }` |

### Update prep-events.server.ts

Add status change event emission in key places:

```typescript
// In prepare-processor.server.ts, when status changes:
await emitPrepEvent({
    assetId: asset.id,
    productId: asset.productId,
    shopId: asset.shopId,
    eventType: "status_changed",
    actorType: "system",
    payload: {
        from: "preparing",
        to: "ready",
        trigger: "prep_complete",
        hasPlacementConfig: !!renderInstructions,
    }
}, null, requestId);

// In api.products.update-instructions.jsx, when enabled changes:
await emitPrepEvent({
    assetId: asset.id,
    productId: asset.productId,
    shopId: shop.id,
    eventType: enabled ? "product_enabled" : "product_disabled",
    actorType: "merchant",
    payload: {
        enabled: enabled,
        status: enabled ? "live" : "ready",
    }
}, session, requestId);
```

### Monitor Dashboard Updates

The monitor's dashboard queries may need updates to:
1. Count products by new status values (unprepared/preparing/ready/live/failed)
2. Track "enabled" vs "disabled" products
3. Show conversion from "ready" → "live" (merchant activation rate)

### Files to Update for Monitor

| File | Changes |
|------|---------|
| `app/services/prep-events.server.ts` | No structural changes, just emit new event types |
| `app/services/prepare-processor.server.ts` | Emit `status_changed` and `placement_config_generated` events |
| `app/routes/api.products.update-instructions.jsx` | Emit `product_enabled`/`product_disabled` events |
| `see-it-monitor/src/lib/db/schema.ts` | No changes needed (schema is generic) |
| `see-it-monitor/app/api/prep/events/route.ts` | No changes needed (accepts any eventType) |

### Monitor Queries to Update

If the monitor has any hardcoded status queries, update:
- `status = 'ready'` → `status = 'live'` for "active products"
- Add dashboard widget for "Merchant Activation Rate" (ready → live conversion)

---

## 11. SUMMARY FOR AI AGENT

**Your task:** Implement the complete status system overhaul as specified above.

**Key changes:**
1. Replace status values: pending/processing/ready/stale/orphaned → unprepared/preparing/ready/live/failed
2. Add `enabled` boolean field to ProductAsset
3. Update prepare-processor to generate placement prompts automatically
4. Update all status checks from "ready" to "live" in storefront code
5. Add "Enable for customers" toggle to the ProductDetailPanel
6. Update all UI badges and status displays
7. Create and run database migration

**Files to modify:** (see Section 5 for complete list)

**Do not break:**
- RenderJob.status (keep as-is: queued/processing/completed/failed)
- Existing render functionality
- Existing storefront widget (just update what it checks)

**Testing:** After implementation, walk through the testing checklist in Section 8.
