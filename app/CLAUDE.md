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
```
ProductAsset.preparedImageUrl  →  compositeScene()  →  Gemini
ProductAsset.renderInstructions (JSON)  →  compositeScene(productInstructions)  →  Gemini prompt
```

## Critical Files
| Purpose | File |
|---------|------|
| Schema | `prisma/schema.prisma` |
| Products page | `app/routes/app.products.jsx` |
| Background removal API | `app/routes/api.products.remove-background.jsx` |
| Save instructions API | `app/routes/api.products.update-instructions.jsx` |
| Compositing | `app/services/gemini.server.ts` → `compositeScene()` |

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
