import { GoogleGenAI } from "@google/genai";
import { logger, createLogContext } from "~/utils/logger.server";
import {
  EXTRACTOR_SYSTEM_PROMPT,
  EXTRACTOR_USER_PROMPT_TEMPLATE,
} from "~/config/prompts/extractor.prompt";
import { deriveScaleGuardrails } from "~/config/prompts/scale-guardrails.config";
import type { ProductPlacementFacts, ExtractionInput } from "./types";

const EXTRACTION_MODEL = "gemini-2.5-flash-preview-05-20";

export async function extractProductFacts(
  input: ExtractionInput,
  requestId: string
): Promise<ProductPlacementFacts> {
  const logContext = createLogContext("prepare", requestId, "extract-start", {
    productTitle: input.title,
  });

  logger.info(logContext, `Starting extraction for: ${input.title}`);

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not set");
  }

  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Build user prompt
  const userPrompt = EXTRACTOR_USER_PROMPT_TEMPLATE.replace(
    "{{title}}",
    input.title
  )
    .replace("{{description}}", input.description || "(no description)")
    .replace("{{productType}}", input.productType || "(unknown)")
    .replace("{{vendor}}", input.vendor || "(unknown)")
    .replace("{{tags}}", input.tags.join(", ") || "(none)")
    .replace(
      "{{metafields}}",
      JSON.stringify(input.metafields, null, 2) || "{}"
    );

  // Build content parts with images
  const parts: any[] = [{ text: EXTRACTOR_SYSTEM_PROMPT }, { text: userPrompt }];

  // Add up to 3 product images
  for (let i = 0; i < Math.min(input.imageUrls.length, 3); i++) {
    try {
      const response = await fetch(input.imageUrls[i]);
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");
        const mimeType = response.headers.get("content-type") || "image/jpeg";
        parts.push({
          inlineData: { mimeType, data: base64 },
        });
      }
    } catch (err) {
      logger.warn(
        { ...logContext, stage: "image-fetch" },
        `Failed to fetch image ${i}: ${err}`
      );
    }
  }

  try {
    const result = await client.models.generateContent({
      model: EXTRACTION_MODEL,
      contents: [{ role: "user", parts }],
      config: {
        responseMimeType: "application/json",
      },
    });

    const text = (result as any)?.text || "{}";
    let facts: ProductPlacementFacts;

    try {
      // Try to parse, handle markdown code blocks
      let jsonStr = text;
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }
      facts = JSON.parse(jsonStr);
    } catch (parseErr) {
      logger.error(
        { ...logContext, stage: "parse" },
        `Failed to parse extraction response: ${parseErr}`
      );
      throw new Error("Failed to parse extraction response as JSON");
    }

    // Derive scale_guardrails deterministically
    facts.scale_guardrails = deriveScaleGuardrails(facts);

    logger.info(
      { ...logContext, stage: "complete" },
      `Extraction complete: ${facts.identity?.product_kind || "unknown"}, scale=${facts.relative_scale?.class}`
    );

    return facts;
  } catch (error) {
    logger.error(logContext, "Extraction failed", error);
    throw error;
  }
}
