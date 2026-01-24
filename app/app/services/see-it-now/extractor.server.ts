import { GoogleGenAI } from "@google/genai";
import { logger, createLogContext } from "~/utils/logger.server";
import {
  EXTRACTOR_SYSTEM_PROMPT,
  EXTRACTOR_USER_PROMPT_TEMPLATE,
} from "~/config/prompts/extractor.prompt";
import {
  deriveScaleGuardrails,
  SCALE_GUARDRAIL_TEMPLATES,
} from "~/config/prompts/scale-guardrails.config";
import type { ProductPlacementFacts, ExtractionInput } from "./types";
import { emit, EventSource, EventType, Severity } from "~/services/telemetry";

// Use an env override so we can change models without a redeploy.
// Default stays on a widely-available Gemini API model.
const EXTRACTION_MODEL =
  process.env.SEE_IT_NOW_EXTRACTOR_MODEL || "gemini-2.5-flash";

class ExtractorOutputError extends Error {
  public readonly code:
    | "EXTRACTOR_OUTPUT_PARSE_FAILED"
    | "EXTRACTOR_OUTPUT_VALIDATION_FAILED";
  public readonly requestId: string;
  public readonly issues: string[];
  public readonly attempt: number;

  constructor(args: {
    code:
      | "EXTRACTOR_OUTPUT_PARSE_FAILED"
      | "EXTRACTOR_OUTPUT_VALIDATION_FAILED";
    message: string;
    requestId: string;
    issues: string[];
    attempt: number;
  }) {
    super(args.message);
    this.name = "ExtractorOutputError";
    this.code = args.code;
    this.requestId = args.requestId;
    this.issues = args.issues;
    this.attempt = args.attempt;
  }
}

const ALLOWED_SCALE_CLASSES = new Set(Object.keys(SCALE_GUARDRAIL_TEMPLATES));

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseExtractorJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1]);
  }

  try {
    return JSON.parse(text);
  } catch {
    const rawJsonMatch = text.match(/\{[\s\S]*\}/);
    if (rawJsonMatch?.[0]) {
      return JSON.parse(rawJsonMatch[0]);
    }
    throw new Error("No JSON object found in extractor response");
  }
}

function validateExtractorFacts(
  value: unknown
): { ok: true; facts: ProductPlacementFacts } | { ok: false; issues: string[] } {
  const issues: string[] = [];

  if (!isPlainObject(value)) {
    return { ok: false, issues: ["root: expected object"] };
  }

  const identity = (value as any).identity;
  if (!isPlainObject(identity)) {
    issues.push("identity: required object");
  } else {
    if (typeof identity.title !== "string" || identity.title.trim().length === 0) {
      issues.push("identity.title: required non-empty string");
    }
    if (
      identity.product_kind !== null &&
      identity.product_kind !== undefined &&
      typeof identity.product_kind !== "string"
    ) {
      issues.push("identity.product_kind: must be string|null");
    }
    if (!Array.isArray(identity.category_path)) {
      issues.push("identity.category_path: required array");
    }
    if (!Array.isArray(identity.style_cues)) {
      issues.push("identity.style_cues: required array");
    }
  }

  const relativeScale = (value as any).relative_scale;
  if (!isPlainObject(relativeScale)) {
    issues.push("relative_scale: required object");
  } else {
    const scaleClass = (relativeScale as any).class;
    if (typeof scaleClass !== "string") {
      issues.push("relative_scale.class: required string");
    } else if (!ALLOWED_SCALE_CLASSES.has(scaleClass)) {
      issues.push(
        `relative_scale.class: invalid value "${scaleClass}" (allowed: ${Array.from(ALLOWED_SCALE_CLASSES).join(
          ", "
        )})`
      );
    }
  }

  const renderBehavior = (value as any).render_behavior;
  if (!isPlainObject(renderBehavior)) {
    issues.push("render_behavior: required object");
  } else {
    const cropping = (renderBehavior as any).cropping_policy;
    const allowedCropping = new Set([
      "never_crop_product",
      "allow_small_crop",
      "allow_crop_if_needed",
    ]);
    if (typeof cropping !== "string" || !allowedCropping.has(cropping)) {
      issues.push(
        `render_behavior.cropping_policy: invalid or missing (allowed: ${Array.from(allowedCropping).join(
          ", "
        )})`
      );
    }
  }

  const requiredObjects = [
    "dimensions_cm",
    "placement",
    "orientation",
    "scale",
    "material_profile",
  ] as const;
  for (const key of requiredObjects) {
    if (!isPlainObject((value as any)[key])) {
      issues.push(`${key}: required object`);
    }
  }
  if (!Array.isArray((value as any).affordances)) {
    issues.push("affordances: required array");
  }
  if (!Array.isArray((value as any).unknowns)) {
    issues.push("unknowns: required array");
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, facts: value as unknown as ProductPlacementFacts };
}

export async function extractProductFacts(
  input: ExtractionInput,
  requestId: string,
  shopId?: string
): Promise<ProductPlacementFacts> {
  const logContext = createLogContext("prepare", requestId, "extract-start", {
    productTitle: input.title,
  });

  logger.info(logContext, `Starting extraction for: ${input.title}`);

  // Emit resolver started event
  if (shopId) {
    emit({
      shopId,
      requestId,
      source: EventSource.PREP,
      type: EventType.PROMPT_RESOLVER_STARTED,
      severity: Severity.INFO,
      payload: {
        productTitle: input.title,
        imageCount: input.imageUrls.length,
        model: EXTRACTION_MODEL,
      },
    });
  }

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
    // Retry exactly once on parse/validation failure (fail-closed).
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await client.models.generateContent({
        model: EXTRACTION_MODEL,
        contents: [{ role: "user", parts }],
        config: {
          responseMimeType: "application/json",
        },
      });

      const text = (result as any)?.text || "{}";

      try {
        const parsed = parseExtractorJson(text);
        const validated = validateExtractorFacts(parsed);
        if (!validated.ok) {
          const issues = validated.issues;
          const scaleIssue = issues.find((i) => i.startsWith("relative_scale.class:"));
          logger.error(
            { ...logContext, stage: "validate", attempt, issuesCount: issues.length },
            scaleIssue
              ? `Extractor output validation failed (scaleClass): ${scaleIssue}`
              : `Extractor output validation failed: ${issues[0]}`
          );

          if (attempt === 0) {
            logger.warn(
              { ...logContext, stage: "validate-retry" },
              "Retrying extraction once due to invalid extractor output"
            );
            continue;
          }

          throw new ExtractorOutputError({
            code: "EXTRACTOR_OUTPUT_VALIDATION_FAILED",
            message: "Extractor output failed validation",
            requestId,
            issues,
            attempt,
          });
        }

        const facts = validated.facts;
        facts.scale_guardrails = deriveScaleGuardrails(facts);

        logger.info(
          { ...logContext, stage: "complete" },
          `Extraction complete: ${facts.identity?.product_kind || "unknown"}, scale=${facts.relative_scale?.class}`
        );

        if (shopId) {
          emit({
            shopId,
            requestId,
            source: EventSource.PREP,
            type: EventType.PROMPT_RESOLVER_COMPLETED,
            severity: Severity.INFO,
            payload: {
              productKind: facts.identity?.product_kind,
              scaleClass: facts.relative_scale?.class,
              materialPrimary: facts.material_profile?.primary,
            },
          });
        }

        return facts;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          { ...logContext, stage: "parse", attempt },
          `Failed to parse/validate extractor response: ${message}`
        );

        if (attempt === 0) {
          logger.warn(
            { ...logContext, stage: "parse-retry" },
            "Retrying extraction once due to malformed/invalid extractor JSON"
          );
          continue;
        }

        if (err instanceof ExtractorOutputError) {
          throw err;
        }

        throw new ExtractorOutputError({
          code: "EXTRACTOR_OUTPUT_PARSE_FAILED",
          message: "Failed to parse extractor response as JSON",
          requestId,
          issues: [message],
          attempt,
        });
      }
    }

    throw new Error("Extractor retry loop exhausted unexpectedly");
  } catch (error) {
    logger.error(logContext, "Extraction failed", error);
    throw error;
  }
}
