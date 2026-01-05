# V2 "One-Shot" Implementation Analysis

## Overview
V2 attempts to generate 4 placement variants in parallel without user interaction, then lets the user choose their favorite.

## How It Works

### Flow
1. **User uploads room photo** → stored in `RoomSession`
2. **User clicks "See It"** → triggers `/app-proxy/render-v2` endpoint
3. **Backend generates 4 variants in parallel**:
   - `open` - "Place naturally in the most open floor space, centered"
   - `wall` - "Place against the main wall, slightly off-center"
   - `light` - "Place near the window or brightest area to catch natural light"
   - `corner` - "Place in the emptiest corner area of the room"
4. **User selects favorite** → `/app-proxy/select-v2` endpoint
5. **Optional upscale** → uses Pro model for higher quality

### Key Files
- `app/app/routes/app-proxy.render-v2.ts` - Main generation endpoint
- `app/app/routes/app-proxy.select-v2.ts` - Selection & upscale endpoint
- `app/extensions/see-it-extension/blocks/see-it-button-v2.liquid` - Frontend UI

---

## Current Prompts

### Main Generation Prompt (render-v2.ts:121-141)
```typescript
function buildHeroShotPrompt(
  productInstructions: string | null,
  placementHint: string
): string {
  return `Place this furniture naturally into this room photograph.

PRODUCT:
${productInstructions || 'Furniture piece'}

PLACEMENT GUIDANCE:
${placementHint}

Look at the room and choose the most logical position following the guidance above.

RULES:
- Match the room's existing lighting and color temperature
- Add natural contact shadow where product meets the floor/surface
- Keep the product's exact proportions - do not stretch or distort
- Make it look like a professional interior photograph
- Do not modify anything else in the room`;
}
```

### Upscale Prompt (select-v2.ts:103-105)
```typescript
const prompt = `Enhance this interior photograph to professional quality.
Improve sharpness, detail, and color accuracy while maintaining the exact composition.
Do not change the placement of any objects.`;
```

---

## Problems Identified

### 1. **Vague Placement Hints**
The placement hints are too generic:
- ❌ "Place naturally in the most open floor space" - doesn't specify size, angle, or exact position
- ❌ "Place against the main wall" - which wall? how far? what angle?
- ❌ "Place near the window" - how near? facing which direction?

**Impact**: AI has too much freedom → inconsistent, poor placements

### 2. **Weak Prompt Structure**
- No system message or role definition
- No explicit size/scale instructions
- No perspective/angle guidance
- No lighting matching details
- Product instructions might be null or generic

**Impact**: Model doesn't understand quality expectations

### 3. **Model Limitations**
- Uses `GEMINI_IMAGE_MODEL_FAST` (`gemini-2.5-flash-image`)
- Max resolution: **1024px** (very low for quality renders)
- Fast model = lower quality output

**Impact**: Low resolution, less detail, worse quality

### 4. **No Context About Product**
- `productInstructions` can be `null` → falls back to "Furniture piece"
- No product dimensions, style, or material info
- No guidance on how product should interact with room

**Impact**: AI doesn't know what it's placing

### 5. **No Quality Constraints**
- No mention of realism requirements
- No occlusion handling instructions
- No shadow quality specifications
- No texture matching guidance

**Impact**: Unrealistic composites, poor shadows, mismatched textures

---

## Recommended Fixes

### Fix 1: Enhanced Prompt with System Message
```typescript
function buildHeroShotPrompt(
  productInstructions: string | null,
  placementHint: string,
  productName?: string
): string {
  const productDesc = productInstructions || 
    (productName ? `${productName} furniture piece` : 'Furniture piece');
  
  return `You are a professional interior design photographer. Your task is to composite a furniture product into a room photograph with photorealistic quality.

PRODUCT TO PLACE:
${productDesc}

PLACEMENT REQUIREMENTS:
${placementHint}

CRITICAL QUALITY REQUIREMENTS:
1. SIZE & SCALE: Place the product at realistic scale relative to room objects (chairs, tables, etc.). Use room elements as reference for proper sizing.
2. PERSPECTIVE: Match the room's camera perspective exactly. The product must align with vanishing points and floor plane.
3. LIGHTING: Analyze the room's light sources (windows, lamps) and match:
   - Light direction and angle
   - Shadow direction and softness
   - Color temperature (warm/cool)
   - Brightness levels
4. SHADOWS: Add realistic contact shadows where product touches floor/surfaces:
   - Shadow should be soft and diffuse
   - Shadow direction must match room lighting
   - Shadow opacity should be 20-40%
5. OCCLUSION: If product should be behind other objects (chairs, tables), respect that occlusion naturally.
6. TEXTURE MATCHING: Product surface should reflect room lighting conditions (glossy surfaces show reflections, matte surfaces absorb light).
7. COLOR HARMONY: Product colors should feel natural in the room's color palette.

COMPOSITION RULES:
- Do NOT modify any existing room elements
- Do NOT add or remove objects
- Do NOT change room lighting
- Keep product's exact proportions (no stretching or distortion)
- Product should look like it was photographed in this room

OUTPUT: Return a single high-quality composite image that looks like a professional interior photograph.`;
}
```

### Fix 2: More Specific Placement Hints
```typescript
const PLACEMENT_VARIANTS = [
  { 
    id: 'open', 
    hint: `Place in the largest open floor area, centered horizontally. Product should face the camera or main viewing angle. Scale should match nearby furniture (if visible). Leave breathing room around the product (at least 2-3 feet of space on all sides).` 
  },
  { 
    id: 'wall', 
    hint: `Place against the most prominent wall in the room, positioned 6-12 inches from the wall. Product should be parallel to the wall. If the wall has windows or artwork, position product to complement (not block) those elements.` 
  },
  { 
    id: 'light', 
    hint: `Place in the brightest area of the room (near windows or main light source). Product should be positioned to receive natural light from the front or side (not backlit). Ensure product is well-lit and visible.` 
  },
  { 
    id: 'corner', 
    hint: `Place in the most empty corner of the room, positioned diagonally to utilize corner space. Product should face outward toward the room center. Leave space between product and both walls (6-12 inches).` 
  },
] as const;
```

### Fix 3: Use Pro Model for Initial Generation
**Option A**: Use Pro model for all variants (slower but better quality)
```typescript
const response = await client.models.generateContent({
  model: GEMINI_IMAGE_MODEL_PRO, // Instead of FAST
  contents: parts,
  config: {
    responseModalities: ['TEXT', 'IMAGE'],
  },
});
```

**Option B**: Generate fast previews, then upscale selected one
- Keep fast model for initial 4 variants
- When user selects, immediately upscale that one
- This is already partially implemented in `select-v2.ts`

### Fix 4: Add Product Context
Ensure `renderInstructions` always has useful info:
```typescript
// In prepare-processor.server.ts or similar
const productDesc = `
Product: ${productName}
Type: ${productType}
Style: ${style}
Materials: ${materials}
Dimensions: ${dimensions}
Color: ${color}
`;
```

### Fix 5: Add Generation Config
```typescript
const response = await client.models.generateContent({
  model: GEMINI_IMAGE_MODEL_FAST,
  contents: parts,
  config: {
    responseModalities: ['TEXT', 'IMAGE'],
    // Add generation config if API supports it
    generationConfig: {
      temperature: 0.3, // Lower = more consistent
      topP: 0.9,
      topK: 40,
    },
  },
});
```

### Fix 6: Better Error Handling & Fallbacks
- If one variant fails, retry with simpler prompt
- If all variants fail, fall back to v1 flow
- Add validation to check if generated image is reasonable quality

---

## Testing Recommendations

1. **Compare prompts side-by-side**:
   - Current prompt vs. enhanced prompt
   - Same room + product, different prompts

2. **Test with different product types**:
   - Large furniture (sofas, beds)
   - Small furniture (chairs, tables)
   - Decorative items (lamps, vases)

3. **Test edge cases**:
   - Cluttered rooms
   - Empty rooms
   - Rooms with unusual lighting
   - Products with complex shapes

4. **Quality metrics**:
   - Shadow realism (1-10 scale)
   - Scale accuracy (1-10 scale)
   - Lighting match (1-10 scale)
   - Overall realism (1-10 scale)

---

## Quick Wins (Easiest to Implement)

1. ✅ **Add product name to prompt** (if available)
2. ✅ **Expand placement hints** with more specific guidance
3. ✅ **Add system message** to define AI's role
4. ✅ **Use Pro model** for at least the selected variant (already partially done)

---

## Next Steps

1. Review this analysis
2. Choose which fixes to implement first
3. Test enhanced prompts on a few examples
4. Iterate based on results
