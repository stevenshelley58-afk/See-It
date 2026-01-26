import { GoogleGenAI } from "@google/genai";
import { logger, createLogContext } from "../utils/logger.server";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface ProductMetadata {
    surface: string;
    orientation: string;
    material: string;
    shadow: string;
    dimensions: { height: number | null; width: number | null };
    customInstructions: string;
}

export async function extractProductMetadata(
    imageUrl: string,
    title: string,
    description: string = '',
    tags: string[] = [],
    metafields: { key: string; value: string }[] = [],
    requestId: string = "metadata"
): Promise<ProductMetadata | null> {
    const logContext = createLogContext("prepare", requestId, "extract", {});

    try {
        logger.info(logContext, `Extracting metadata for: ${title}`);

        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
            logger.warn(logContext, `Failed to fetch image: ${imageResponse.status}`);
            return null;
        }
        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        const imageBase64 = imageBuffer.toString('base64');

        const prompt = `Analyze this furniture/home product for room visualization placement.

PRODUCT:
Title: ${title}
Description: ${description || 'None'}
Tags: ${tags.join(', ') || 'None'}
${metafields.length ? `Metafields: ${metafields.map(m => m.key + ': ' + m.value).join(', ')}` : ''}

Return ONLY valid JSON:
{
  "surface": "floor|wall|table|ceiling|shelf",
  "orientation": "upright|flat|leaning|wall-mounted|hanging|draped",
  "material": "matte|semi-gloss|gloss|reflective|transparent|fabric",
  "shadow": "contact|cast|soft|none",
  "dimensions": { "height": null, "width": null },
  "customInstructions": ""
}

Rules:
- surface: where it belongs (sofas/beds/chairs=floor, art/mirrors=wall or floor, lamps/vases=table)
- orientation: how it sits (floor mirrors=leaning, rugs=flat, pendants=hanging)
- material: dominant finish from image (mirrors/glass/chrome=reflective, velvet/linen=fabric)
- shadow: contact for heavy items, soft for glass/delicate, cast for wall-mounted
- dimensions: IMPORTANT - extract from description. Look for "measurements" "dimensions" "size" followed by numbers. Parse "180 x 95" as height=180, width=95. Handle typos like "x25xm". Return values in cm.
- customInstructions: brief notes about unique features affecting placement

JSON only, no markdown.`;

        const response = await ai.models.generateContent({
            model: "gemini-2.0-flash",
            contents: [
                { text: prompt },
                { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }
            ]
        });

        const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
            logger.warn(logContext, `No JSON in response: ${text.substring(0, 200)}`);
            return null;
        }

        const parsed = JSON.parse(jsonMatch[0]);
        logger.info(logContext, `Extracted metadata: ${JSON.stringify(parsed)}`);

        return {
            surface: parsed.surface || 'floor',
            orientation: parsed.orientation || 'upright',
            material: parsed.material || 'matte',
            shadow: parsed.shadow || 'contact',
            dimensions: {
                height: typeof parsed.dimensions?.height === 'number' ? parsed.dimensions.height : null,
                width: typeof parsed.dimensions?.width === 'number' ? parsed.dimensions.width : null
            },
            customInstructions: parsed.customInstructions || ''
        };
    } catch (error) {
        logger.error(logContext, "Metadata extraction failed", error);
        return null;
    }
}
