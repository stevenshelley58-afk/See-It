# See It - Shopify App

## What This Is
Shopify merchants prepare product images (background removal + placement metadata) so customers can visualize products in their rooms.

## Tech Stack
- Remix + Shopify App Bridge
- Prisma + PostgreSQL (Supabase)
- Google Cloud Storage
- Railway (hosting)
- Gemini 2.5 Flash (compositing), Prodia (background removal)

## Current Task
Redesigning Products page. See `docs/PRODUCT_PREP_REDESIGN.md` for spec.

## Key Data Flow (Canonical Pipeline)

### Prepare Phase (Merchant-time, Background Processing)
```
Shopify Product (title, description, metafields, image)
  |
Background Processor (prepare-processor.server.ts)
  |-- Background removal -> preparedImageUrl (transparent PNG)
  |-- LLM #1: Extract product facts -> extractedFacts (JSON)
  |-- Merge with merchant overrides -> resolvedFacts (JSON)
  \-- LLM #2: Generate placement set -> placementSet (JSON with variants)
  |
ProductAsset saved with:
  - preparedImageUrl / preparedImageKey
  - extractedFacts (LLM #1 output: ProductFacts)
  - merchantOverrides (sparse diff from merchant edits)
  - resolvedFacts (merged: extracted + overrides)
  - placementSet (LLM #2 output: { productDescription, variants[] })
  - extractedAt (timestamp)
```

### Placement Tab (Merchant Review/Confirm)
```
Merchant opens Placement tab
  |
Loads extractedFacts + merchantOverrides -> Shows resolved values
  |
Merchant adjusts overrides -> Sparse diff saved to merchantOverrides
  |
System regenerates resolvedFacts + placementSet
```

### Final Render (Customer-time)
```
ProductAsset.preparedImageUrl (transparent PNG)
  +
Room photo (from RoomSession)
  +
Customer placement coords + scale
  +
Prompt from placementSet.variants[selected]
  |
compositeScene() -> Gemini API
  |
Composited room photo with product placed realistically
```

## Canonical ProductAsset Fields
```
extractedFacts    Json?     // LLM #1 output: ProductFacts
merchantOverrides Json?     // Merchant edits (diff only)
resolvedFacts     Json?     // merged(extracted, overrides)
placementSet      Json?     // LLM #2 output: { productDescription, variants[] }
extractedAt       DateTime?
```

## Critical Files
| Purpose | File |
|---------|------|
| Schema | `prisma/schema.prisma` (ProductAsset with canonical fields) |
| Products page | `app/routes/app.products.jsx` |
| Background processor | `app/services/prepare-processor.server.ts` |
| Canonical pipeline | `app/services/see-it-now/index.ts` (extractProductFacts, buildPlacementSet, resolveProductFacts) |
| Placement UI | `app/components/ProductDetailPanel/PlacementTab.jsx` |
| Save placement API | `app/routes/api.products.update-instructions.jsx` |
| Compositing | `app/services/gemini.server.ts` |

## Commands
```bash
npm run build        # Build (run before commit)
npm run deploy       # Deploy Shopify app config
```

## Deployment
- **App**: Push to GitHub → Railway auto-deploys
- **Monitor**: Push to GitHub → Vercel auto-deploys
- **Local dev not supported** - no local database or tunnel

## Rules
1. Read the spec before coding: `docs/PRODUCT_PREP_REDESIGN.md`
2. Use existing UI components from `app/components/ui/`
3. Test `npm run build` passes before committing
4. One feature at a time - don't batch changes
