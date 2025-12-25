# Gemini 2.5 Object Removal - Best Practices Guide

**Last Updated:** December 2024
**Source:** Google Gemini API Documentation + Community Tips + See It App Implementation

---

## Overview

This guide covers best practices for using Gemini 2.5 Flash Image (`gemini-2.5-flash-image`) and Gemini 3 Pro Image Preview (`gemini-3-pro-image-preview`) for object removal tasks.

---

## TL;DR - Quick Tips

1. **One edit at a time** - Break complex edits into sequential steps
2. **Describe scenes, not keywords** - Use natural language (73% better results)
3. **Be hyper-specific** - Include what to remove AND what to preserve
4. **Start under 2MB** - Large images get compressed, losing quality
5. **Mask dilation: 1-2%** - Smooth borders for convincing edits
6. **Iterate, don't restart** - Use multi-turn conversation for refinement
7. **Composite results** - Lock pixels outside edit region to prevent drift

---

## Key Principles

### 1. **Clear Image Labeling**
When sending multiple images (room + mask), clearly label each image so Gemini understands which is which:

```javascript
const parts = [
    { text: "I have two images for you:" },
    { text: "FIRST IMAGE - This is a photograph of a room:" },
    {
        inlineData: {
            mimeType: 'image/png',
            data: roomBuffer.toString('base64')
        }
    },
    { text: "SECOND IMAGE - This is a mask where WHITE areas indicate objects to REMOVE:" },
    {
        inlineData: {
            mimeType: 'image/png',
            data: maskBuffer.toString('base64')
        }
    },
    { text: prompt }
];
```

### 2. **Prompt Structure Best Practices**

#### ✅ DO: Be Explicit About What to Remove and What to Keep

```
OBJECT REMOVAL TASK

Using the FIRST IMAGE (the room photograph) and the SECOND IMAGE (the mask):

YOUR TASK:
1. Look at the SECOND IMAGE (mask) - the WHITE areas show what objects to REMOVE from the room
2. In the FIRST IMAGE, identify and COMPLETELY REMOVE all objects that correspond to the WHITE areas in the mask
3. Fill the removed areas with the surrounding background (wall, floor, or surface) so it looks natural

CRITICAL RULES:
- Output MUST be EXACTLY {width}x{height} pixels
- Keep the SAME camera angle, zoom, and framing as the first image
- DO NOT crop, extend, or resize
- DO NOT add any new objects, people, or furniture
- The final image should look like the original room but with the masked objects completely gone
```

#### ✅ DO: Specify Preservation Requirements

From Google's documentation:
> "When working with image masking prompts, you should clearly specify which element you want to change and what it should become, while explicitly instructing the model to keep everything else exactly the same."

**Key phrases to include:**
- "Keep the rest of the room unchanged"
- "Preserve the original lighting and composition"
- "Maintain the same camera angle and framing"
- "Keep all other elements exactly as they are"

#### ✅ DO: Use Dual Instructions
State both:
1. **What to modify** (remove objects in white mask areas)
2. **What to preserve** (everything else, lighting, style, composition)

### 3. **Image Placement**

**For single-image prompts:** Place the image BEFORE the text prompt for better performance.

**For multi-image prompts:** Use natural ordering that makes sense contextually:
- Room image first (what you're editing)
- Mask image second (what to remove)
- Text prompt last (instructions)

### 4. **Mask Preparation**

#### Pre-processing the Mask

```typescript
// Expand mask edges to capture full object boundary
const MASK_EXPANSION_PX = 16;  // Medium spill - expand mask edges
const MASK_FEATHER_SIGMA = 6;  // Soft edges for natural blending

const editRegionMask = await sharp(maskBuffer)
    .grayscale()
    .removeAlpha()
    .threshold(128)                           // Clean binary mask
    .blur(Math.max(1, MASK_EXPANSION_PX * 0.7))  // Expand via blur
    .threshold(64)                            // Re-threshold after expansion
    .blur(MASK_FEATHER_SIGMA)                 // Feather edges
    .png()
    .toBuffer();
```

**Why this helps:**
- Expansion captures full object boundaries even with rough user painting
- Feathering creates soft edges for natural blending
- Prevents hard edges that look artificial

### 5. **Dimension Matching**

**CRITICAL:** Ensure mask dimensions exactly match the room image dimensions.

```typescript
if (maskWidth !== roomWidth || maskHeight !== roomHeight) {
    throw new Error(
        `Mask dimension mismatch: mask is ${maskWidth}x${maskHeight}, room is ${roomWidth}x${roomHeight}. ` +
        `Mask must exactly match room dimensions.`
    );
}
```

### 6. **Aspect Ratio Handling**

Gemini supports specific aspect ratios. Find the closest match:

```typescript
const GEMINI_SUPPORTED_RATIOS = [
    { label: '1:1',   value: 1.0 },
    { label: '4:5',   value: 0.8 },
    { label: '5:4',   value: 1.25 },
    { label: '3:4',   value: 0.75 },
    { label: '4:3',   value: 4/3 },
    { label: '2:3',   value: 2/3 },
    { label: '3:2',   value: 1.5 },
    { label: '9:16',  value: 9/16 },
    { label: '16:9', value: 16/9 },
    { label: '21:9', value: 21/9 },
];

// Use in config:
const config = {
    responseModalities: ['TEXT', 'IMAGE'],
    imageConfig: { aspectRatio: closestRatio.label }
};
```

### 7. **Model Selection Strategy**

Use a fallback strategy:
1. **First attempt:** `gemini-2.5-flash-image` (fast, good for most cases)
2. **Retry on failure:** `gemini-3-pro-image-preview` (higher quality, supports 4K)

```typescript
let attempt = 0;
const maxAttempts = 2;
while (attempt < maxAttempts) {
    const model = attempt === 0 ? GEMINI_IMAGE_MODEL_FAST : GEMINI_IMAGE_MODEL_PRO;
    try {
        const result = await callGemini(model);
        break; // Success
    } catch (error) {
        attempt++;
        if (attempt >= maxAttempts) throw error;
    }
}
```

### 8. **Post-Processing: Compositing**

Gemini may return slightly different dimensions. Use compositing to ensure exact pixel-perfect results:

```typescript
// Resize Gemini output to match input dimensions
if (outputWidth !== roomWidth || outputHeight !== roomHeight) {
    geminiOutputBuffer = await sharp(geminiOutputBuffer)
        .resize(roomWidth, roomHeight, { fit: 'cover', position: 'center' })
        .png()
        .toBuffer();
}

// Composite: outside edit region = original, inside = Gemini output
// This hard-locks pixels outside the edit region to prevent unwanted changes
const alpha = maskData[maskIdx] / 255;
resultData[idx] = Math.round(roomData[idx] * (1 - alpha) + geminiData[idx] * alpha);
```

**Why compositing matters:**
- Prevents Gemini from modifying areas outside the mask
- Ensures exact dimension matching
- Preserves original pixels where no edit was requested

---

## Prompt Template

Use this template as a starting point:

```
OBJECT REMOVAL TASK

Using the FIRST IMAGE (the room photograph) and the SECOND IMAGE (the mask):

YOUR TASK:
1. Look at the SECOND IMAGE (mask) - the WHITE areas show what objects to REMOVE from the room
2. In the FIRST IMAGE, identify and COMPLETELY REMOVE all objects that correspond to the WHITE areas in the mask
3. Fill the removed areas with the surrounding background (wall, floor, or surface) so it looks natural

CRITICAL RULES:
- Output MUST be EXACTLY {width}x{height} pixels
- Keep the SAME camera angle, zoom, and framing as the first image
- DO NOT crop, extend, or resize
- DO NOT add any new objects, people, or furniture
- Preserve the original lighting, shadows, and color grading
- Keep all other elements exactly as they are
- The final image should look like the original room but with the masked objects completely gone

Output: Return ONLY the cleaned room image with objects removed.
```

---

## Common Pitfalls to Avoid

### ❌ DON'T: Use Vague Prompts
```
Bad: "Remove the objects"
Good: "Remove all objects that correspond to the WHITE areas in the SECOND IMAGE (mask)"
```

### ❌ DON'T: Forget to Specify Preservation
```
Bad: "Remove the sofa"
Good: "Remove the sofa. Keep everything else exactly the same, including lighting, shadows, and camera angle."
```

### ❌ DON'T: Skip Dimension Validation
Always validate that mask and room images have matching dimensions before calling Gemini.

### ❌ DON'T: Skip Compositing
Even if Gemini returns the correct dimensions, use compositing to hard-lock pixels outside the edit region.

### ❌ DON'T: Use Wrong Model
- ✅ Use `gemini-2.5-flash-image` or `gemini-3-pro-image-preview` for editing
- ❌ Don't use `imagen-*` models (they only generate, can't edit)

---

## API Configuration

```typescript
const config = {
    responseModalities: ['TEXT', 'IMAGE'],  // Request both text and image
    imageConfig: {
        aspectRatio: '16:9'  // Match closest supported ratio
    }
};

const response = await client.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: parts,
    config,
});
```

---

## Response Handling

```typescript
const candidates = response.candidates;
if (candidates?.[0]?.content?.parts) {
    for (const part of candidates[0].content.parts) {
        if (part.inlineData?.data) {
            const imageBuffer = Buffer.from(part.inlineData.data, 'base64');
            // Process image...
        }
        if (part.text) {
            console.log('Gemini text response:', part.text);
        }
    }
}
```

---

## Timeout Handling

Set appropriate timeouts for Gemini API calls:

```typescript
const GEMINI_TIMEOUT_MS = 60000; // 60 seconds

const response = await withTimeout(
    client.models.generateContent({...}),
    GEMINI_TIMEOUT_MS,
    'Gemini cleanup API call'
);
```

---

## Community Tips & Tricks (from Reddit, Forums, Guides)

### Prompt Engineering Secrets

#### Describe Scenes, Not Keywords
```
❌ Bad:  "room, no sofa, clean, modern"
✅ Good: "This is a modern living room. Remove the sofa and fill the area
         to match the hardwood floor and white wall texture behind it."
```
> Official data shows descriptive paragraphs achieve 73% better results than keyword stuffing.

#### Use Photographic/Cinematic Language
Control composition with terms like:
- "wide-angle shot" / "macro shot"
- "low-angle perspective" / "85mm portrait lens"
- "soft studio light from camera left"
- "preserve original depth and bokeh"

#### Explicit Constraints Template
```
"Remove [object]. Fill the area to match the [floor/wall] texture.
Do not alter the subject's face, pose, or clothing.
Keep the same camera angle, zoom, and framing.
Preserve the original lighting, shadows, and color grading."
```

#### Object Removal Best Prompts (from Skylum)
```
"Remove distracting background elements while preserving original depth
and bokeh. Patch gaps with matching texture and avoid changes to subject edges."
```

### Quality Preservation Tips

1. **Start under 2MB** - Large images are automatically compressed by Google, leading to quality loss
2. **Save after each edit** - Keep a copy after each successful edit to preserve quality
3. **Limit iterations** - Don't over-edit; each pass can degrade quality
4. **Use negative constraints** - "No blur, no artifact, no watermark, no unrealistic skin smoothing"
5. **Specify preservation** - "preserve identity", "do not alter composition", "maintain pose"

### Iterative Refinement Strategy
Gemini has excellent memory in multi-turn conversations:
```
Turn 1: "Remove the lamp from the corner"
Turn 2: "Keep the composition, just darken the tones a bit"
Turn 3: "Perfect. Now remove the power cord visible on the floor"
```
> Stepwise edits work better than overloading instructions per Google's 2025 guidance.

### Fixing Common Problems

#### "Content Is Not Permitted" Error
- Remove triggering words (body parts, weapons, political names, copyrighted characters)
- Use neutral, descriptive language avoiding slang
- Crop images to target areas only—smaller crops reduce false positives
- Retry later - the filter can be inconsistent

#### Poor Edit Quality
- Make single edits sequentially rather than bulk changes
- Include strict constraints: "Do not alter the subject's face, pose, or clothing"
- Try upscaling the result if output appears degraded

#### Aspect Ratio Changes
If Gemini changes your aspect ratio, be explicit:
```
"Update the input image... Do not change the input aspect ratio."
```

#### Background Looks Flat After Removal
- Consider depth and bokeh in your prompt
- Mention "preserve original depth" or "maintain background blur"
- Describe what should fill the area: "fill with matching hardwood floor texture"

---

## Imagen 3 vs Gemini 2.5 Flash

| Feature | Gemini 2.5 Flash | Imagen 3 |
|---------|------------------|----------|
| Mask Input | Natural language (describe area) | Explicit mask image |
| Best For | Context-aware edits, complex reasoning | Precise pixel-level control |
| Edit Steps | N/A | Start at 12, max 75 |
| Mask Dilation | Handled in prompt | 1-2% recommended (0.01-0.02) |
| Speed | ~2.3 seconds average | Slower |
| Quality Focus | Contextual coherence | Visual fidelity |

**When to use Imagen 3 instead:**
- You need precise pixel-level mask control
- Object removal requires surgical precision
- Quality is more important than speed
- You have a pre-made mask image

---

## Advanced: Semantic Mask Approach (Imagen 3)

For Imagen 3 on Vertex AI, you can use semantic segmentation:

```javascript
// Auto-detect and mask by object class
{
    "editMode": "EDIT_MODE_INPAINT_REMOVAL",
    "maskMode": "MASK_MODE_SEMANTIC",
    "maskClasses": [67]  // e.g., 67 = tables
}
```

Mask modes available:
- `MASK_MODE_BACKGROUND` - Auto-detect and mask background
- `MASK_MODE_FOREGROUND` - Auto-detect and mask foreground objects
- `MASK_MODE_SEMANTIC` - Use semantic segmentation with class IDs

---

## References

- **Official Docs:** https://ai.google.dev/gemini-api/docs/image-generation
- **Image Understanding:** https://ai.google.dev/gemini-api/docs/image-understanding
- **Prompting Best Practices:** https://ai.google.dev/gemini-api/docs/prompting_with_media
- **Google Developers Blog:** https://developers.googleblog.com/en/how-to-prompt-gemini-2-5-flash-image-generation-for-the-best-results/
- **Vertex AI Inpainting:** https://docs.cloud.google.com/vertex-ai/generative-ai/docs/image/edit-remove-objects
- **Firebase Imagen:** https://firebase.google.com/docs/ai-logic/edit-images-imagen-remove-objects
- **Troubleshooting Guide:** https://www.ywian.com/blog/gemini-image-editing-guide-troubleshooting
- **Current Implementation:** `app/app/services/room-cleanup.server.ts`

---

## Summary Checklist

- [ ] Label images clearly (FIRST IMAGE, SECOND IMAGE)
- [ ] Use explicit prompts with dual instructions (what to remove + what to keep)
- [ ] Describe scenes naturally, not just keywords
- [ ] Include explicit preservation constraints
- [ ] Validate mask and room dimensions match exactly
- [ ] Pre-process mask (expand 16px + feather sigma 6)
- [ ] Use mask dilation of 1-2% for Imagen
- [ ] Start with images under 2MB to avoid compression
- [ ] Use correct aspect ratio in config
- [ ] Implement model fallback (fast → pro)
- [ ] Use iterative refinement for complex edits
- [ ] Post-process with compositing to lock pixels outside edit region
- [ ] Handle timeouts gracefully (60 seconds recommended)
- [ ] Extract image from response correctly
- [ ] Log all stages for debugging

