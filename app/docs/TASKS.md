# Claude Code Tasks

Paste these one at a time. Complete each before moving to next.

---

## TASK 1: Verify Pipeline

```
Check that prepared images flow through to compositing.

1. Find where compositeScene() is called (search the codebase)
2. Verify preparedImageUrl from ProductAsset is passed as first argument
3. Verify renderInstructions is passed as productInstructions parameter

Show me the call site code. If anything is missing, fix it.
```

---

## TASK 2: Create ProductDetailPanel Shell

```
Read docs/PRODUCT_PREP_REDESIGN.md first.

Create app/components/ProductDetailPanel.jsx:
- Modal with header (title + status + close button)
- Two tabs: "Prepare Image" | "Placement Settings"
- Content area (placeholder divs for now)
- Footer: Cancel + Save buttons
- Props: product, asset, isOpen, onClose, onSave

Use Polaris Modal or build with Tailwind. Match the style in product-prep-demo.html.
```

---

## TASK 3: Implement PrepareTab

```
Create app/components/ProductDetailPanel/PrepareTab.jsx

Features:
- Image selector thumbnails (if product.images.length > 1)
- Side-by-side: Original | Prepared (checkerboard background)
- useFetcher to POST /api/products/remove-background with { productId, imageUrl }
- Loading spinner during processing
- Buttons: "Auto Remove Background", "Refine", "Upload Instead"

Look at ManualSegmentModal.jsx for patterns to reuse.
```

---

## TASK 4: Implement PlacementTab

```
Create app/components/ProductDetailPanel/PlacementTab.jsx

Features:
- Auto-detect structured fields from product data (title, description, metafields)
- Button groups: surface, orientation, material, shadow
- Number inputs: height (cm), width (cm)
- Textarea: additional notes
- Placement Rules: Scene Role, Replacement Rule, Allow Space Creation
- "Generate Prompt" button → Creates prose placement prompt from structured fields
- Editable placement prompt textarea (with edit warning)

Data saved:
- placementFields (JSON): { surface, material, orientation, shadow, dimensions, additionalNotes, fieldSource }
- renderInstructions (prose string): Natural-language placement prompt
- Placement rule columns: sceneRole, replacementRule, allowSpaceCreation
- All marked as 'merchant' in fieldSource when saved (never overwritten by bulk prepare)
```

---

## TASK 5: Implement RefineView

```
Create app/components/ProductDetailPanel/RefineView.jsx

Copy canvas drawing logic from ManualSegmentModal.jsx - don't rewrite.

Features:
- Header with close button
- Canvas with image + mask overlay
- Brush size slider (10-80px)
- Mouse + touch drawing handlers
- useFetcher to POST /api/products/apply-mask
- Buttons: Apply, Clear, Cancel
```

---

## TASK 6: Wire Up Components

```
Update ProductDetailPanel.jsx:
- Import PrepareTab, PlacementTab, RefineView
- State: activeTab, showRefine, metadata
- Render correct component based on state
- Save button calls /api/products/update-instructions
- Pass callbacks through to child components

Test full flow: open modal → switch tabs → auto remove → refine → save.
```

---

## TASK 7: Update Products List

```
Modify app/routes/app.products.jsx per docs/PRODUCT_PREP_REDESIGN.md:

1. Add search input + filter logic
2. Add bulk selection (selectedIds state)
3. Update table: checkbox | images | product | price | status
4. Remove individual action buttons
5. Make rows clickable → open ProductDetailPanel
6. Add bulk actions bar (appears when items selected)
7. Sort: active → in-stock → price desc

Remove ManualSegmentModal import.
```

---

## TASK 8: Cleanup

```
1. Rename ManualSegmentModal.jsx to ManualSegmentModal.deprecated.jsx
2. Search for any remaining imports of ManualSegmentModal and remove
3. Run npm run build - fix any errors
4. Commit with message: "Redesign product preparation UI"
```

---

## TASK 9: Deploy

```
1. Run npm run build
2. Push to main
3. Check Railway dashboard for deploy status
4. Test in production: open product, remove background, configure, save
```

---

## Recovery Prompts

**Lost context:**
```
Read CLAUDE.md and docs/PRODUCT_PREP_REDESIGN.md. What task am I on?
```

**Drifting from spec:**
```
Open product-prep-demo.html. Compare to what you built. What's different?
```

**API errors:**
```
Show me: 1) the endpoint file 2) what it expects 3) what you're sending
```

**Build errors:**
```
Run npm run build. Show me the exact error message.
```
