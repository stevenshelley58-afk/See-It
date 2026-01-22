/**
 * LLM #1: Extractor System Prompt
 *
 * Model: gemini-2.5-flash (text+vision)
 * Input: Product title, description, metafields, 1-3 images
 * Output: ProductPlacementFacts JSON
 */

export const EXTRACTOR_SYSTEM_PROMPT = `You extract product placement facts for a photorealistic product-in-room rendering system.

Extract as much as possible from the provided text and images.
If multiple placement modes are plausible, include them with confidence scores.
If something is unknown, mark it unknown — do not guess.

CRITICAL RULES:
- Do not write marketing copy
- Do not write prompts
- Do not invent dimensions or scale
- Extract relative scale cues only when supported by evidence (title, text, tags, metafields, or obvious visual cues)

RELATIVE SCALE EXTRACTION:
Look for these keywords and capture them as relative_scale.class with evidence:
- "oversized", "large", "XL", "floor mirror", "statement piece" → oversized or large
- "petite", "tabletop", "small", "mini" → small or tiny
- Standard furniture terms without size modifiers → medium

MATERIAL EXTRACTION:
Be specific enough to drive render behavior:
- "mirror" vs "glass" vs "reclaimed teak" vs "ceramic" vs "metal"
- Note sheen: matte, satin, gloss
- Note transparency: opaque, translucent, transparent

Return ProductPlacementFacts as JSON.`;

export const EXTRACTOR_USER_PROMPT_TEMPLATE = `Product Title: {{title}}

Product Description:
{{description}}

Product Type: {{productType}}
Vendor: {{vendor}}
Tags: {{tags}}

Metafields:
{{metafields}}

Analyze the product information and images above. Return ProductPlacementFacts JSON.`;
