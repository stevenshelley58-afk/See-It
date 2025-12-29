# Product Preparation Redesign

## Reference
Open `product-prep-demo-v2.html` in browser - build exactly this.

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
- Auto-detection hint banner
- Surface: floor/wall/table/ceiling/shelf
- Orientation: upright/flat/leaning/wall-mounted/hanging/draped
- Material: matte/semi-gloss/gloss/reflective/transparent/fabric
- Shadow: contact/cast/soft/none
- Dimensions: height, width (cm)
- Custom instructions textarea
- AI prompt preview

### Refine View (replaces modal content)
- Canvas drawing over image
- Brush size slider
- Apply / Clear / Cancel

## APIs (existing, don't modify)
- `POST /api/products/remove-background` → { productId, imageUrl }
- `POST /api/products/apply-mask` → { productId, maskDataUrl, imageUrl }
- `POST /api/products/update-instructions` → { productId, instructions: JSON.stringify({...}) }

## Files
**Create:**
- `app/components/ProductDetailPanel.jsx`
- `app/components/ProductDetailPanel/PrepareTab.jsx`
- `app/components/ProductDetailPanel/PlacementTab.jsx`
- `app/components/ProductDetailPanel/RefineView.jsx`

**Modify:**
- `app/routes/app.products.jsx`

**Delete:**
- `app/components/ManualSegmentModal.jsx` (after migration)
