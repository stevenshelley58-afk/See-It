# Google Gemini/Imagen Models Reference

```
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║   🔒 THIS FILE IS FOR REFERENCE ONLY - DO NOT EDIT MODEL NAMES HERE 🔒   ║
║                                                                            ║
║   All model names are defined in:                                         ║
║   • app/config/ai-models.config.ts (Remix app)                            ║
║   • image-service/ai-models.config.js (Image service)                     ║
║                                                                            ║
║   ⚠️  AGENTS: These config files are LOCKED. DO NOT MODIFY. ⚠️           ║
║   If you think a model name needs updating:                               ║
║   1. Check the official docs first (links below)                          ║
║   2. Ask the user for permission                                          ║
║   3. Update ONLY the config files, not individual service files           ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
```

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
- ✅ Background removal (ask in prompt) - **BUT outputs white bg, not transparent!**
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

## For See It App - Model Usage

| Task | Model Used | Config Import | Notes |
|------|-----------|---------------|-------|
| Remove product background | `@imgly/background-removal-node` | N/A | Gemini doesn't support transparency! |
| Composite product into room | `GEMINI_IMAGE_MODEL_PRO` | `ai-models.config` | AI polish step |

---

## ❌ DEPRECATED/INVALID Model Names - DO NOT USE

These model names **DO NOT EXIST** and will cause errors:

| Invalid Name | Why It's Wrong |
|--------------|----------------|
| `gemini-2.5-flash-image-preview` | Remove the `-preview` suffix |
| `gemini-3-pro-image` | Needs `-preview` at the end |
| `imagen-3.0-capability-001` | This model doesn't exist |
| `gemini-2.0-flash-preview-image-generation` | Old preview name, deprecated |

---

## Why Background Removal Uses imgly, Not Gemini

**Gemini does NOT support transparent PNG output.** When you ask Gemini to "remove the background," it outputs a **white background**, not actual alpha transparency.

For true transparency, we use `@imgly/background-removal-node` which outputs proper PNG with alpha channel.

---

## Official Documentation Links

- Image Generation: https://ai.google.dev/gemini-api/docs/image-generation
- Imagen: https://ai.google.dev/gemini-api/docs/imagen
- All Models: https://ai.google.dev/gemini-api/docs/models

---

## Config File Locations

```
See It/
├── app/
│   └── app/
│       └── config/
│           └── ai-models.config.ts   ← 🔒 SINGLE SOURCE OF TRUTH (Remix)
└── image-service/
    └── ai-models.config.js           ← 🔒 SINGLE SOURCE OF TRUTH (Image Service)
```

**All AI model names are imported from these files. Do not define model names anywhere else.**
