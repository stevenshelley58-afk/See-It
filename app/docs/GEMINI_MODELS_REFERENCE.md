# Google Gemini/Imagen Models Reference

**Last Verified:** December 5, 2024  
**Source:** https://ai.google.dev/gemini-api/docs/image-generation

---

## Key Insight for See It App

For **image editing** (background removal, compositing), you MUST use `generateContent` with the **Gemini image models**, NOT the Imagen models.

- **Imagen models** = Pure text-to-image generation only
- **Gemini image models** = Text-to-image AND image editing (what we need!)

---

## Image EDITING Models (use `generateContent`)

These are the "Nano Banana" models for editing/compositing:

| Model Code | Nickname | Use Case | Max Resolution |
|------------|----------|----------|----------------|
| `gemini-2.5-flash-image` | Nano Banana | Fast, high-volume tasks | 1024px |
| `gemini-3-pro-image-preview` | Nano Banana Pro | Professional, complex edits, 4K | Up to 4K |

### Capabilities:
- ✅ Text-to-image generation
- ✅ Image editing (add/remove/modify elements)
- ✅ Background removal (ask in prompt)
- ✅ Style transfer
- ✅ Multi-image composition
- ✅ Inpainting (semantic masking)

### API Usage:
```javascript
const response = await client.models.generateContent({
    model: "gemini-2.5-flash-image",  // or gemini-3-pro-image-preview
    contents: [prompt, imageBuffer],
    config: {
        responseModalities: ['TEXT', 'IMAGE']
    }
});
```

---

## Image GENERATION Models (use `generateImages`)

These Imagen models are for pure text-to-image only:

| Model Code | Tier | Latest Update |
|------------|------|---------------|
| `imagen-4.0-generate-001` | Standard | June 2025 |
| `imagen-4.0-ultra-generate-001` | Ultra (best quality) | June 2025 |
| `imagen-4.0-fast-generate-001` | Fast | June 2025 |
| `imagen-3.0-generate-002` | Legacy | February 2025 |

### Capabilities:
- ✅ Text-to-image generation
- ❌ Cannot edit existing images
- ❌ Cannot remove backgrounds
- ❌ Cannot composite images

### API Usage:
```javascript
const response = await client.models.generateImages({
    model: 'imagen-4.0-generate-001',
    prompt: 'A robot holding a red skateboard',
    config: {
        numberOfImages: 4
    }
});
```

---

## For See It App - Recommended Models

| Task | Model to Use | API Method |
|------|--------------|------------|
| Remove product background | `gemini-2.5-flash-image` | `generateContent` |
| Clean up room (remove furniture) | `gemini-2.5-flash-image` | `generateContent` |
| Composite product into room | `gemini-2.5-flash-image` | `generateContent` |

---

## DEPRECATED/INVALID Model Names

These model names DO NOT EXIST and will cause errors:

- ❌ `gemini-2.5-flash-image-preview` (wrong)
- ❌ `gemini-3-pro-image` (wrong - needs `-preview`)
- ❌ `imagen-3.0-capability-001` (doesn't exist)
- ❌ `gemini-2.0-flash-preview-image-generation` (old preview name)

---

## Official Documentation Links

- Image Generation: https://ai.google.dev/gemini-api/docs/image-generation
- Imagen: https://ai.google.dev/gemini-api/docs/imagen
- All Models: https://ai.google.dev/gemini-api/docs/models

