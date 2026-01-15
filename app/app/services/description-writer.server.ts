/**
 * DESCRIPTION WRITER SERVICE
 * See It - Production Grade
 * 
 * Purpose: Take structured product data and write an optimized prose description
 * that Gemini will use for compositing.
 * 
 * This runs ONCE during product prep, NOT at render time.
 * The merchant sees the result and can edit if needed.
 */

import { GoogleGenAI } from "@google/genai";
import { logger, createLogContext } from "../utils/logger.server";

// Use cheap/fast model for text generation
const DESCRIPTION_MODEL = "gemini-2.0-flash-lite";

// ============================================================================
// TYPES
// ============================================================================

export interface ProductData {
    title: string;
    description?: string;
    productType?: string;
    vendor?: string;
    tags?: string[];
}

export interface StructuredFields {
    surface: 'floor' | 'wall' | 'table' | 'ceiling' | 'shelf' | 'other';
    orientation: 'upright' | 'flat' | 'leaning' | 'wall-mounted' | 'hanging' | 'draped' | 'other';
    material: 'fabric' | 'wood' | 'metal' | 'glass' | 'ceramic' | 'stone' | 'leather' | 'mixed' | 'other';
    shadow: 'contact' | 'cast' | 'soft' | 'none';
    dimensions?: { height?: number; width?: number };
    additionalNotes?: string;
}

export interface GeneratedDescription {
    description: string;
    confidence: 'high' | 'medium' | 'low';
    model: string;
    generatedAt: string;
    rawPrompt?: string; // Optional: full prompt sent to text model for lineage tracking
}

// ============================================================================
// THE PROMPT THAT WRITES THE DESCRIPTION
// ============================================================================

const DESCRIPTION_WRITER_PROMPT = `You write product descriptions for interior photography. Your descriptions help photographers and AI systems understand how to light and position furniture and home decor.

Write ONE PARAGRAPH (3-5 sentences) describing the product as it would appear in a professionally shot interior photograph.

FOCUS ON:
- Visual appearance: shape, proportions, distinctive design features
- Materials and how they interact with light (does it reflect? absorb? scatter?)
- Surface qualities: texture, finish, sheen, patina
- Approximate real-world size if dimensions are provided
- Any special visual properties (transparency, patterns, grain, weave)

AVOID:
- Marketing language, brand claims, or sales copy
- Placement instructions ("place on floor") - the customer chooses where
- Functionality descriptions ("perfect for relaxing") - just describe appearance
- Technical specs that don't affect visual appearance

WRITE IT LIKE: You're telling a photographer what to expect when the product arrives for a catalogue shoot. What will they see? How will it catch the light?

EXAMPLES:

"A substantial three-seater sofa with deep cushions upholstered in charcoal grey velvet. The fabric has a subtle sheen that catches light softly, with visible texture in the pile. Low wooden legs in dark walnut. Approximately 220cm wide with generous, sink-in proportions."

"A full-length floor mirror with a slim brass frame showing warm, aged patina where hands have touched it over time. The glass has a very slight smoke tint, giving soft reflections rather than mirror-sharp ones. Stands about 180cm tall, designed to lean against a wall at a shallow angle."

"A hand-thrown ceramic vase with an organic, slightly asymmetrical silhouette. Deep teal glaze pools darker in the crevices and breaks lighter on the raised curves. Matte finish with subtle throwing marks visible. About 30cm tall."

NOW DESCRIBE THIS PRODUCT:`;

// ============================================================================
// MAIN FUNCTION
// ============================================================================

export async function generateProductDescription(
    product: ProductData,
    fields: StructuredFields,
    requestId: string = "desc-writer"
): Promise<GeneratedDescription> {
    
    const logContext = createLogContext("description", requestId, "generate", {
        productTitle: product.title,
        surface: fields.surface,
        material: fields.material
    });
    
    logger.info(logContext, "Generating product description");
    
    // Build the context for the writer
    const contextParts: string[] = [];
    
    // Product title and type
    contextParts.push(`Product: ${product.title}`);
    if (product.productType) {
        contextParts.push(`Type: ${product.productType}`);
    }
    
    // Structured fields
    contextParts.push(`Material: ${fields.material}`);
    contextParts.push(`Typical placement: ${fields.surface}`);
    contextParts.push(`Orientation: ${fields.orientation}`);
    
    if (fields.dimensions?.height || fields.dimensions?.width) {
        const dims: string[] = [];
        if (fields.dimensions.height) dims.push(`${fields.dimensions.height}cm tall`);
        if (fields.dimensions.width) dims.push(`${fields.dimensions.width}cm wide`);
        contextParts.push(`Dimensions: ${dims.join(', ')}`);
    }
    
    // Original product description (if useful)
    if (product.description && product.description.length > 20) {
        // Truncate if too long
        const truncated = product.description.slice(0, 500);
        contextParts.push(`Original description: "${truncated}"`);
    }
    
    // Merchant's additional notes
    if (fields.additionalNotes?.trim()) {
        contextParts.push(`Special notes from merchant: "${fields.additionalNotes.trim()}"`);
    }
    
    const fullPrompt = `${DESCRIPTION_WRITER_PROMPT}

${contextParts.join('\n')}

Write the description now (one paragraph, 3-5 sentences):`;

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
        
        const response = await ai.models.generateContent({
            model: DESCRIPTION_MODEL,
            contents: fullPrompt,
            config: {
                temperature: 0.7,  // Some creativity but not wild
                maxOutputTokens: 300,
            }
        });
        
        const description = response.text?.trim();
        
        if (!description || description.length < 50) {
            throw new Error("Generated description too short or empty");
        }
        
        // Clean up any markdown or quotes the model might have added
        const cleanDescription = description
            .replace(/^["']|["']$/g, '')  // Remove surrounding quotes
            .replace(/^\*\*|\*\*$/g, '')  // Remove markdown bold
            .trim();
        
        logger.info(
            { ...logContext, stage: "complete" },
            `Generated description: ${cleanDescription.length} chars`
        );
        
        return {
            description: cleanDescription,
            confidence: 'high',
            model: DESCRIPTION_MODEL,
            generatedAt: new Date().toISOString(),
            rawPrompt: fullPrompt, // Include full prompt for telemetry/lineage
        };
        
    } catch (error: any) {
        logger.error(logContext, "Description generation failed", error);
        
        // Fallback: create a basic description from structured data
        const fallback = createFallbackDescription(product, fields);
        
        return {
            description: fallback,
            confidence: 'low',
            model: 'fallback',
            generatedAt: new Date().toISOString(),
            // No rawPrompt for fallback (not from API call)
        };
    }
}

// ============================================================================
// FALLBACK (if API fails)
// ============================================================================

function createFallbackDescription(product: ProductData, fields: StructuredFields): string {
    const parts: string[] = [];
    
    // Basic product description
    const article = /^[aeiou]/i.test(product.title) ? 'An' : 'A';
    parts.push(`${article} ${product.title.toLowerCase()}`);
    
    // Material
    if (fields.material && fields.material !== 'other') {
        parts.push(`made of ${fields.material}`);
    }
    
    // Dimensions
    if (fields.dimensions?.height && fields.dimensions?.width) {
        parts.push(`approximately ${fields.dimensions.height}cm × ${fields.dimensions.width}cm`);
    } else if (fields.dimensions?.height) {
        parts.push(`approximately ${fields.dimensions.height}cm tall`);
    }
    
    return parts.join(', ') + '.';
}

// ============================================================================
// AUTO-EXTRACT STRUCTURED FIELDS FROM PRODUCT DATA
// ============================================================================

const SURFACE_KEYWORDS: Record<string, string[]> = {
    floor: ['sofa', 'couch', 'chair', 'armchair', 'ottoman', 'bed', 'dresser', 'cabinet', 'bookshelf', 'bookcase', 'rug', 'carpet', 'floor lamp', 'standing', 'sectional', 'bench', 'coffee table', 'side table', 'console', 'credenza'],
    wall: ['mirror', 'art', 'painting', 'print', 'poster', 'frame', 'wall art', 'canvas', 'tapestry', 'clock', 'sconce', 'wall lamp', 'shelf', 'floating shelf'],
    table: ['lamp', 'table lamp', 'vase', 'planter', 'pot', 'candle', 'picture frame', 'photo frame', 'sculpture', 'figurine', 'bowl', 'tray', 'ornament', 'desk lamp', 'bookend'],
    ceiling: ['pendant', 'chandelier', 'hanging lamp', 'ceiling light', 'hanging planter', 'mobile'],
    shelf: ['book', 'basket', 'storage box', 'small plant', 'succulent'],
};

const MATERIAL_KEYWORDS: Record<string, string[]> = {
    fabric: ['fabric', 'upholstered', 'velvet', 'linen', 'cotton', 'wool', 'textile', 'woven', 'cushion', 'sofa', 'couch', 'chair', 'bed'],
    wood: ['wood', 'wooden', 'oak', 'walnut', 'teak', 'pine', 'birch', 'mahogany', 'bamboo', 'timber', 'rattan'],
    metal: ['metal', 'steel', 'iron', 'brass', 'copper', 'chrome', 'aluminum', 'gold', 'silver', 'bronze'],
    glass: ['glass', 'crystal', 'mirror', 'transparent'],
    ceramic: ['ceramic', 'porcelain', 'pottery', 'clay', 'terracotta', 'stoneware'],
    stone: ['stone', 'marble', 'granite', 'slate', 'concrete', 'terrazzo', 'quartz'],
    leather: ['leather', 'faux leather', 'vegan leather', 'suede'],
};

export function extractStructuredFields(product: ProductData): StructuredFields {
    const allText = `${product.title} ${product.description || ''} ${product.productType || ''} ${(product.tags || []).join(' ')}`.toLowerCase();
    
    // Find surface
    let surface: StructuredFields['surface'] = 'floor';
    for (const [surf, keywords] of Object.entries(SURFACE_KEYWORDS)) {
        if (keywords.some(k => allText.includes(k))) {
            surface = surf as StructuredFields['surface'];
            break;
        }
    }
    
    // Find material
    let material: StructuredFields['material'] = 'other';
    for (const [mat, keywords] of Object.entries(MATERIAL_KEYWORDS)) {
        if (keywords.some(k => allText.includes(k))) {
            material = mat as StructuredFields['material'];
            break;
        }
    }
    
    // Infer orientation
    let orientation: StructuredFields['orientation'] = 'upright';
    if (allText.includes('rug') || allText.includes('carpet') || allText.includes('mat')) {
        orientation = 'flat';
    } else if ((allText.includes('mirror') || allText.includes('art')) && surface === 'floor') {
        orientation = 'leaning';
    } else if (surface === 'wall') {
        orientation = 'wall-mounted';
    } else if (surface === 'ceiling') {
        orientation = 'hanging';
    }
    
    // Extract dimensions from description
    const dimensions = extractDimensions(product.description || '');
    
    return {
        surface,
        orientation,
        material,
        shadow: surface === 'ceiling' ? 'none' : 'contact',
        dimensions,
    };
}

function extractDimensions(text: string): { height?: number; width?: number } | undefined {
    if (!text) return undefined;

    // Strip basic HTML + common entities (descriptionHtml/metafields can contain both)
    const clean = text
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&times;/gi, '×')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();

    // Pattern: explicit height/width (be conservative with unlabeled "A × B")
    // Many PDPs use "25×25cm" to mean footprint (W×D), not height×width.
    const hasExplicitAxes =
        /\b(h(?:eight)?)\b/i.test(clean) ||
        /\b(w(?:idth)?)\b/i.test(clean) ||
        /\bH\s*[x×]\s*W\b/i.test(clean) ||
        /\bW\s*[x×]\s*H\b/i.test(clean) ||
        /\bHxW\b/i.test(clean) ||
        /\bWxH\b/i.test(clean);

    if (hasExplicitAxes) {
        const cross = clean.match(/(\d{2,4}(?:\.\d+)?)\s*(?:cm|mm|")?\s*[x×]\s*(\d{2,4}(?:\.\d+)?)\s*(?:cm|mm|")?/i);
        if (cross) {
            return {
                height: parseFloat(cross[1]),
                width: parseFloat(cross[2]),
            };
        }
    }

    // Pattern: "Height: 90cm", "H: 90", "Width 200"
    const heightMatch = clean.match(/\b(h(?:eight)?)\s*[:\s-]*(\d{2,4}(?:\.\d+)?)/i);
    const widthMatch = clean.match(/\b(w(?:idth)?)\s*[:\s-]*(\d{2,4}(?:\.\d+)?)/i);
    if (heightMatch || widthMatch) {
        return {
            height: heightMatch ? parseFloat(heightMatch[2]) : undefined,
            width: widthMatch ? parseFloat(widthMatch[2]) : undefined,
        };
    }

    return undefined;
}
