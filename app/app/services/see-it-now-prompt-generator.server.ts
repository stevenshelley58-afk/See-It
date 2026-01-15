/**
 * SEE IT NOW PROMPT GENERATOR SERVICE
 * 
 * Purpose: Generate complete per-product prompts for See It Now during prepare phase.
 * The generator returns ONLY the PRODUCT-SPECIFIC prompt section and a default set of variants.
 * 
 * This runs during product preparation and stores the result for merchant review.
 */

import { GoogleGenAI } from "@google/genai";
import { logger, createLogContext } from "../utils/logger.server";

// Use cheap/fast model for text generation (align with description-writer)
const PROMPT_GENERATION_MODEL = "gemini-2.0-flash-lite";

// ============================================================================
// TYPES
// ============================================================================

export interface ProductData {
    title: string;
    description?: string;
    productType?: string;
    vendor?: string;
    tags?: string[];
    dimensions?: {
        height?: number | null;
        width?: number | null;
        depth?: number | null;
    };
    placementFields?: {
        surface?: string | null;
        material?: string | null;
        orientation?: string | null;
        shadow?: string | null;
        additionalNotes?: string | null;
    };
}

export interface VariantConfig {
    id: string;
    prompt: string;
}

export interface PromptGeneratorResult {
    productPrompt: string;           // The generated PRODUCT-SPECIFIC section (no general prompt)
    archetype: string;               // Detected archetype
    selectedVariants: VariantConfig[]; // Variants based on archetype
}

// Archetype definitions
type Archetype = 
    | "oversized_architectural"
    | "large_furniture"
    | "medium_furniture"
    | "small_homewares"
    | "wall_mounted_decor";

// Variation definitions from template
const VARIATION_PROMPTS: Record<number, string> = {
    1: "Place the product in the most obvious and conventional location where this type of product would naturally belong, scaled realistically.",
    2: "Place the product in a different but still natural location, scaled realistically.",
    3: "Place the product in an accommodating location, scaled slightly smaller than typical so it feels comfortably fitted.",
    4: "Place the product in a plausible secondary location, scaled accurately to real-world proportions.",
    5: "Place the product in a strong location, scaled slightly larger than typical so it feels intentionally sized.",
    6: "Place the product in a different natural location, scaled larger than a standard version would normally be.",
    7: "Place the product in a clear, visually strong area where it can act as a focal point.",
    8: "Place the product near existing elements in an integrated way, allowing proximity or partial occlusion if natural.",
    9: "Place the product in a less central but appropriate location, prioritizing subtlety.",
    10: "Choose the location and scale most likely to result in a believable real photograph.",
};

// Archetype priority map (from template)
const ARCHETYPE_VARIATIONS: Record<Archetype, { primary: number[]; secondary: number[] }> = {
    oversized_architectural: { primary: [5, 6, 7, 10], secondary: [1, 2] },
    large_furniture: { primary: [1, 4, 5, 10], secondary: [2, 8] },
    medium_furniture: { primary: [1, 4, 8, 10], secondary: [2, 3] },
    small_homewares: { primary: [3, 8, 9, 10], secondary: [1, 2] },
    wall_mounted_decor: { primary: [1, 2, 4, 10], secondary: [8, 9] },
};

// ============================================================================
// PROMPT TEMPLATE
// ============================================================================

const PROMPT_GENERATION_TEMPLATE = `You are generating a complete prompt for an ecommerce visualization system that places products into customer room photos.

PRODUCTION PROMPT TEMPLATE:

GENERAL PROMPT (use for all products)
This image is generated for a live ecommerce visualization showing how a real product would look in a customer's home.

The first image is the exact product being sold and must remain unchanged.
The second image is a real room photo taken by a customer.

Make the product appear naturally present in the room by matching the scene's perspective, lighting, and overall visual character. Only make the minimal changes required for realistic physical interaction such as shadows, reflections, and occlusion.

If product photos appear to contradict stated dimensions, defer to the written dimensions.

Return only the final composed image. No text.

---

PRODUCT-SPECIFIC PROMPT (write per SKU)
PRODUCT IDENTITY
The product is a [PRODUCT TYPE], with a [CONSTRUCTION CUE: solid / heavy / delicate / lightweight] build.
Dimensions: [HEIGHT] cm tall × [WIDTH] cm wide × [DEPTH] cm deep.

CATEGORY OVERRIDE (only if the model would misclassify)
This is not a typical [COMMON ASSUMPTION]. Treat it as [CORRECT CLASSIFICATION].

SCALE CLASS (choose one)
Oversized / architectural — should claim significant visual space and must not be scaled down for convenience.

OR

Standard furniture — scale using nearby furniture and human-scale objects as reference.

OR

Small homeware — remain modestly scaled and must not be enlarged to dominate the room.

PLACEMENT BEHAVIOUR
This product is [floor-standing / floor-standing and leaning / surface-placed / wall-mounted].

SCALE REFERENCE
Judge scale against [ceiling height / door frames / sofas / tables / countertops].

DOMINANCE (choose one)
Dominant — focal point that should command attention.

OR

Integrated — sits naturally alongside other elements.

OR

Subtle — visually secondary with minimal presence.

REALISM CONSTRAINT
Physical believability wins. An awkward but realistic placement is better than a clean but implausible one.

---

VARIATION PROMPTS (select based on archetype)

1. Baseline: Place the product in the most obvious and conventional location where this type of product would naturally belong, scaled realistically.

2. Alternate natural location: Place the product in a different but still natural location, scaled realistically.

3. Slightly undersized: Place the product in an accommodating location, scaled slightly smaller than typical so it feels comfortably fitted.

4. Secondary location, true scale: Place the product in a plausible secondary location, scaled accurately to real-world proportions.

5. Slightly oversized: Place the product in a strong location, scaled slightly larger than typical so it feels intentionally sized.

6. Oversized vs standard: Place the product in a different natural location, scaled larger than a standard version would normally be.

7. Focal placement: Place the product in a clear, visually strong area where it can act as a focal point.

8. Integrated proximity: Place the product near existing elements in an integrated way, allowing proximity or partial occlusion if natural.

9. Low-impact: Place the product in a less central but appropriate location, prioritizing subtlety.

10. Believability fallback: Choose the location and scale most likely to result in a believable real photograph.

ARCHETYPE PRIORITY MAP:
- Oversized Architectural: Primary [5, 6, 7, 10], Secondary [1, 2]
- Large Furniture: Primary [1, 4, 5, 10], Secondary [2, 8]
- Medium Furniture: Primary [1, 4, 8, 10], Secondary [2, 3]
- Small Homewares: Primary [3, 8, 9, 10], Secondary [1, 2]
- Wall-Mounted Decor: Primary [1, 2, 4, 10], Secondary [8, 9]

---

TASK:
Based on the product information below, generate:
1. The complete PRODUCT-SPECIFIC PROMPT section (all subsections filled in). Do NOT include the GENERAL PROMPT.
2. The detected archetype (one of: oversized_architectural, large_furniture, medium_furniture, small_homewares, wall_mounted_decor)

Respond in JSON format:
{
  "productPrompt": "PRODUCT IDENTITY\n...\nSCALE CLASS\n...\n[complete product-specific section]",
  "archetype": "large_furniture"
}`;

// ============================================================================
// MAIN FUNCTION
// ============================================================================

export async function generateSeeItNowPrompt(
    productData: ProductData,
    requestId: string = "prompt-generator"
): Promise<PromptGeneratorResult> {
    const logContext = createLogContext("prepare", requestId, "see-it-now-prompt-generate", {
        productTitle: productData.title,
    });

    logger.info(logContext, "Generating See It Now prompt");

    if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY environment variable is not set");
    }

    const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    try {
        // Build product context
        const contextParts: string[] = [];
        contextParts.push(`Product Title: ${productData.title}`);
        
        if (productData.description) {
            contextParts.push(`Description: ${productData.description.substring(0, 500)}`);
        }
        
        if (productData.productType) {
            contextParts.push(`Product Type: ${productData.productType}`);
        }
        
        if (productData.vendor) {
            contextParts.push(`Vendor: ${productData.vendor}`);
        }
        
        if (productData.tags && productData.tags.length > 0) {
            contextParts.push(`Tags: ${productData.tags.join(", ")}`);
        }

        // Dimensions
        const dims = productData.dimensions;
        if (dims) {
            const dimParts: string[] = [];
            if (dims.height) dimParts.push(`${dims.height} cm tall`);
            if (dims.width) dimParts.push(`${dims.width} cm wide`);
            if (dims.depth) dimParts.push(`${dims.depth} cm deep`);
            if (dimParts.length > 0) {
                contextParts.push(`Dimensions: ${dimParts.join(" × ")}`);
            }
        }

        // Placement fields
        const fields = productData.placementFields;
        if (fields) {
            if (fields.surface) contextParts.push(`Surface: ${fields.surface}`);
            if (fields.material) contextParts.push(`Material: ${fields.material}`);
            if (fields.orientation) contextParts.push(`Orientation: ${fields.orientation}`);
            if (fields.shadow) contextParts.push(`Shadow: ${fields.shadow}`);
            if (fields.additionalNotes) {
                contextParts.push(`Additional Notes: ${fields.additionalNotes}`);
            }
        }

        const productContext = contextParts.join("\n");

        // Call Gemini
        const prompt = `${PROMPT_GENERATION_TEMPLATE}\n\nPRODUCT INFORMATION:\n${productContext}`;

        const result = await genAI.models.generateContent({
            model: PROMPT_GENERATION_MODEL,
            contents: prompt,
            config: {
                temperature: 0.2,
                maxOutputTokens: 1400,
            },
        });

        const responseText = result.text || "";

        // Extract JSON from response
        let jsonStr = responseText;
        const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
            jsonStr = jsonMatch[1];
        } else {
            const rawJsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (rawJsonMatch) {
                jsonStr = rawJsonMatch[0];
            }
        }

        const parsed = JSON.parse(jsonStr);
        const archetype = parsed.archetype as Archetype;

        // Validate archetype
        if (!ARCHETYPE_VARIATIONS[archetype]) {
            logger.warn(
                { ...logContext, invalidArchetype: archetype },
                `Invalid archetype detected: ${archetype}, defaulting to medium_furniture`
            );
            // Default to medium_furniture if invalid
            const defaultArchetype: Archetype = "medium_furniture";
            const defaultVariations = getDefaultVariationNumbers(defaultArchetype);
            return {
                productPrompt: parsed.productPrompt || "",
                archetype: defaultArchetype,
                selectedVariants: buildVariantsFromNumbers(defaultVariations),
            };
        }

        // Build variant configs deterministically from archetype map (no LLM-driven selection)
        const variationNumbers = getDefaultVariationNumbers(archetype);
        const selectedVariants = buildVariantsFromNumbers(variationNumbers);

        logger.info(
            { ...logContext, archetype, variantCount: selectedVariants.length },
            `Generated prompt with archetype: ${archetype}, ${selectedVariants.length} variants`
        );

        return {
            productPrompt: (parsed.productPrompt || "").trim(),
            archetype,
            selectedVariants,
        };
    } catch (error) {
        logger.error(
            logContext,
            "Failed to generate See It Now prompt",
            error
        );
        throw error;
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function buildVariantsFromNumbers(variationNumbers: number[]): VariantConfig[] {
    return variationNumbers
        .filter((num) => VARIATION_PROMPTS[num]) // Only include valid variation numbers
        .map((num) => ({
            id: `variation_${num}`,
            prompt: VARIATION_PROMPTS[num],
        }));
}

function getDefaultVariationNumbers(archetype: Archetype): number[] {
    const config = ARCHETYPE_VARIATIONS[archetype];
    const primary = Array.isArray(config?.primary) ? config.primary : [];
    const secondary = Array.isArray(config?.secondary) ? config.secondary : [];
    // 4-6 variations total: all primary + up to 2 secondary (per template)
    return [...primary, ...secondary.slice(0, 2)];
}
