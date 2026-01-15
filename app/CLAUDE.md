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

## Key Data Flow

### Prepare Phase (Merchant-time, Background Processing)
```
Shopify Product (title, description, metafields, image)
  ↓
Background Processor (prepare-processor.server.ts)
  ├─→ Background removal → preparedImageUrl (transparent PNG)
  ├─→ Extract structured fields (surface, material, orientation, shadow, dimensions)
  ├─→ Generate prose placement prompt → renderInstructions
  └─→ Set placement rules (sceneRole, replacementRule, allowSpaceCreation)
  ↓
ProductAsset saved with:
  - preparedImageUrl / preparedImageKey
  - placementFields (JSON: structured fields)
  - renderInstructions (prose: natural-language placement prompt)
  - sceneRole, replacementRule, allowSpaceCreation (placement rule columns)
  - fieldSource (JSON: provenance tracking, 'auto' vs 'merchant')
```

### Placement Tab (Merchant Review/Confirm)
```
Merchant opens Placement tab
  ↓
Loads saved placementFields → Toggles show saved values (or auto-detected if not saved)
  ↓
Merchant adjusts toggles → Confirms/corrects extraction
  ↓
Merchant clicks "Generate Prompt" → Creates prose from structured fields
  ↓
Merchant saves → All fields marked as 'merchant' in fieldSource (never overwritten by bulk prepare)
```

### Final Render (Customer-time, V1)
```
ProductAsset.preparedImageUrl (transparent PNG)
  +
Room photo (from RoomSession)
  +
Customer placement coords + scale
  +
ProductAsset.renderInstructions (prose placement prompt)
  ↓
compositeScene() → Gemini API
  ↓
Composited room photo with product placed realistically
```

## Critical Files
| Purpose | File |
|---------|------|
| Schema | `prisma/schema.prisma` (ProductAsset has placementFields JSON, renderInstructions prose, placement rule columns) |
| Products page | `app/routes/app.products.jsx` |
| Background processor | `app/services/prepare-processor.server.ts` (generates placement during bulk prepare) |
| Placement prompt generator | `app/services/description-writer.server.ts` (structured fields → prose) |
| Placement UI | `app/components/ProductDetailPanel/PlacementTab.jsx` (confirms/corrects extraction) |
| Save placement API | `app/routes/api.products.update-instructions.jsx` (saves with merchant provenance) |
| Compositing | `app/services/gemini.server.ts` → `compositeScene()` (uses renderInstructions prose prompt) |

## Commands
```bash
npm run dev          # Local dev
npm run build        # Build (run before commit)
npx prisma studio    # View database
```

## Rules
1. Read the spec before coding: `docs/PRODUCT_PREP_REDESIGN.md`
2. Use existing UI components from `app/components/ui/`
3. Test `npm run build` passes before committing
4. One feature at a time - don't batch changes
