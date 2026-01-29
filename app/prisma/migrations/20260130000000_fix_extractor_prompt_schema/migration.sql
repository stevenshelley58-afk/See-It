-- Fix: Add JSON schema to product_fact_extractor prompt
-- The LLM was returning arbitrary JSON because no schema was specified

UPDATE "PromptVersion"
SET "systemTemplate" = 'You extract product placement facts for a photorealistic product-in-room rendering system.

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
- "oversized", "large", "XL", "floor mirror", "statement piece" → "oversized" or "large"
- "petite", "tabletop", "small", "mini" → "small" or "tiny"
- Standard furniture terms without size modifiers → "medium"
IMPORTANT: relative_scale.class must be exactly ONE of: "tiny", "small", "medium", "large", "oversized", "architectural", "unknown"

MATERIAL EXTRACTION:
Be specific enough to drive render behavior:
- "mirror" vs "glass" vs "reclaimed teak" vs "ceramic" vs "metal"
- Note sheen: matte, satin, gloss
- Note transparency: opaque, translucent, transparent

Return JSON matching this exact schema:
{
  "identity": {
    "title": "string (product title)",
    "product_kind": "string|null (e.g., ''floor mirror'', ''dining table'', ''vase'')",
    "category_path": ["string array of category hierarchy"],
    "style_cues": ["string array of style descriptors"]
  },
  "dimensions_cm": {
    "h": "number|null", "w": "number|null", "d": "number|null",
    "diameter": "number|null", "thickness": "number|null"
  },
  "weight_class": "very_heavy|heavy|medium|light|unknown",
  "deformability": "rigid|semi_rigid|flexible_drape|unknown",
  "placement": {
    "allowed_modes": [{"mode": "string", "confidence": 0-1, "evidence": "string|null"}],
    "support_surfaces": [{"surface": "string", "confidence": 0-1, "evidence": "string|null"}],
    "constraints": ["string array"],
    "do_not_do": ["string array"]
  },
  "orientation": {
    "constraint": "upright_only|can_rotate_slightly|free_rotation|unknown",
    "notes": "string|null"
  },
  "scale": {
    "priority": "strict_true_to_dimensions|prefer_true_to_dimensions|flexible_if_no_reference",
    "notes": "string|null"
  },
  "relative_scale": {
    "class": "tiny|small|medium|large|oversized|architectural|unknown",
    "evidence": "string|null",
    "comparisons": [{"to": "string", "confidence": 0-1, "evidence": "string|null"}]
  },
  "material_profile": {
    "primary": "reclaimed_teak|painted_wood|glass|mirror|ceramic|metal|stone|fabric|leather|mixed|unknown",
    "sheen": "matte|satin|gloss|unknown",
    "transparency": "opaque|translucent|transparent|unknown",
    "notes": "string|null"
  },
  "render_behavior": {
    "surface": [{"kind": "string", "strength": "string|null", "notes": "string|null"}],
    "lighting": [{"kind": "string", "notes": "string|null"}],
    "interaction_rules": ["string array"],
    "cropping_policy": "never_crop_product|allow_small_crop|allow_crop_if_needed"
  },
  "affordances": ["string array of product affordances"],
  "unknowns": ["string array of things that couldn''t be determined"]
}',
    "version" = "version" + 1,
    "changeNotes" = 'Add JSON schema to fix LLM output structure'
WHERE "promptDefinitionId" IN (
    SELECT "id" FROM "PromptDefinition"
    WHERE "name" = 'product_fact_extractor'
)
AND "status" = 'ACTIVE';
