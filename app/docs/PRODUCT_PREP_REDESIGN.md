# Product Preparation Redesign

## Reference
Open `product-prep-demo.html` in browser - build exactly this.

## Products List
- Columns: Checkbox | Images (original→prepared) | Product | Price | Status
- Search bar filters by title/handle
- Bulk select with "Prepare Selected" button (warning modal)
- Click row → opens ProductDetailPanel
- Sort: active first, in-stock first, then price desc
- **Remove**: individual action buttons, bottom legend

## Product Detail Panel (Modal)
```
┌────────────────────────────────────────┐
│ [Title]                [Status]    [X] │
├────────────────────────────────────────┤
│ [Prepare Image] [Placement Settings]   │
├────────────────────────────────────────┤
│            Tab Content                 │
├────────────────────────────────────────┤
│ [Cancel]                [Save Changes] │
└────────────────────────────────────────┘
```

### Tab 1: Prepare Image
- Image selector (if multiple)
- Original | Prepared side-by-side (checkerboard bg)
- Buttons: Auto Remove, Refine, Upload Instead

### Tab 2: Placement Settings
- Auto-detection hint banner (shows "Auto-detected • Review & adjust")
- Product Properties (structured fields, saved to `placementFields` JSON):
  - Surface: floor/wall/table/ceiling/shelf
  - Orientation: upright/flat/leaning/wall-mounted/hanging/draped
  - Material: fabric/wood/metal/glass/ceramic/stone/leather/mixed/other
  - Shadow: contact/cast/soft/none
  - Dimensions: height, width (cm)
  - Additional notes textarea
- Placement Rules (saved to separate columns):
  - Scene Role: Dominant / Integrated
  - Replacement Rule: Same Role Only / Similar Size or Position / Any Blocking Object / None
  - Allow Space Creation: checkbox
- Placement Prompt (prose text, saved to `renderInstructions`):
  - Generated from structured fields above
  - Natural language prompt that helps AI place product realistically
  - Merchant can edit, but warned it's optimized for AI rendering

### Refine View (replaces modal content)
- Canvas drawing over image
- Brush size slider
- Apply / Clear / Cancel

## APIs
- `POST /api/products/remove-background` → { productId, imageUrl }
- `POST /api/products/apply-mask` → { productId, maskDataUrl, imageUrl }
- `POST /api/products/update-instructions` → { productId, instructions: string (prose prompt), placementFields: JSON, sceneRole, replacementRule, allowSpaceCreation }
- `POST /api/products/generate-description` → Generates placement prompt from structured fields

## Data Flow

### Prepare Phase (Merchant-time)
1. Merchant triggers bulk prepare OR single prepare
2. Background processor:
   - Removes background from product image
   - Extracts structured placement fields from product title/description/metafields (best guess)
   - Generates natural-language placement prompt (prose)
   - Sets placement rules (sceneRole, replacementRule, allowSpaceCreation)
   - Saves to `ProductAsset`: `placementFields` (JSON), `renderInstructions` (prose), placement rule columns
   - Marks all as `fieldSource: 'auto'` in provenance tracking

### Placement Tab (Merchant Review/Confirm)
1. Opens with saved `placementFields` if present, else auto-detected defaults
2. Merchant toggles adjust structured fields (surface, material, orientation, shadow, dimensions, notes)
3. Merchant clicks "Generate Prompt" → Creates prose placement prompt from current field values
4. Merchant can edit prompt manually (shows warning)
5. On Save: All fields marked as `fieldSource: 'merchant'` - bulk prepare will never overwrite

### Final Render (Customer-time, V1)
- Uses `preparedImageUrl` (transparent PNG cutout)
- Uses `renderInstructions` (prose placement prompt) in compositeScene prompt
- Customer provides placement coords + scale
- Server resizes product image and composites into room photo with prompt guidance

## Files
**Main Components:**
- `app/components/ProductDetailPanel.jsx` - Modal container
- `app/components/ProductDetailPanel/PrepareTab.jsx` - Image preparation
- `app/components/ProductDetailPanel/PlacementTab.jsx` - Placement field confirmation + prompt generation
- `app/components/ProductDetailPanel/RefineView.jsx` - Canvas-based mask refinement

**Backend:**
- `app/services/prepare-processor.server.ts` - Background worker that processes pending assets (generates placement during bulk prepare)
- `app/services/description-writer.server.ts` - Generates prose placement prompts from structured fields
- `app/routes/api.products.update-instructions.jsx` - Saves merchant edits with provenance tracking
