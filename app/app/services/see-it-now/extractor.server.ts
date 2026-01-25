// =============================================================================
// CANONICAL: Product Fact Extractor (LLM #1)
// Extracts ProductFacts from Shopify product data
// =============================================================================

import { GoogleGenAI } from "@google/genai";
import { logger, createLogContext } from "~/utils/logger.server";
import { deriveScaleGuardrails, SCALE_GUARDRAIL_TEMPLATES } from "~/config/prompts/scale-guardrails.config";
import type { ProductFacts, ExtractionInput, DebugPayload, CallSummary, OutputSummary, PreparedImage } from "./types";
import { emit, EventSource, EventType, Severity } from "~/services/telemetry";
import { resolvePromptText } from "../prompt-control/prompt-resolver.server";
import { startCall, completeCallSuccess, completeCallFailure } from "../prompt-control/llm-call-tracker.server";
import { computeCallIdentityHash, computeDedupeHash, computeImageHash } from "./hashing.server";

// Use an env override so we can change models without a redeploy.
const EXTRACTION_MODEL = process.env.SEE_IT_NOW_EXTRACTOR_MODEL || "gemini-2.5-flash";

class ExtractorOutputError extends Error {
  public readonly code: "EXTRACTOR_OUTPUT_PARSE_FAILED" | "EXTRACTOR_OUTPUT_VALIDATION_FAILED";
  public readonly requestId: string;
  public readonly issues: string[];
  public readonly attempt: number;

  constructor(args: {
    code: "EXTRACTOR_OUTPUT_PARSE_FAILED" | "EXTRACTOR_OUTPUT_VALIDATION_FAILED";
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
): { ok: true; facts: ProductFacts } | { ok: false; issues: string[] } {
  const issues: string[] = [];

  if (!isPlainObject(value)) {
    return { ok: false, issues: ["root: expected object"] };
  }

  const identity = (value as Record<string, unknown>).identity;
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

  const relativeScale = (value as Record<string, unknown>).relative_scale;
  if (!isPlainObject(relativeScale)) {
    issues.push("relative_scale: required object");
  } else {
    const scaleClass = (relativeScale as Record<string, unknown>).class;
    if (typeof scaleClass !== "string") {
      issues.push("relative_scale.class: required string");
    } else if (!ALLOWED_SCALE_CLASSES.has(scaleClass)) {
      issues.push(
        `relative_scale.class: invalid value "${scaleClass}" (allowed: ${Array.from(ALLOWED_SCALE_CLASSES).join(", ")})`
      );
    }
  }

  const renderBehavior = (value as Record<string, unknown>).render_behavior;
  if (!isPlainObject(renderBehavior)) {
    issues.push("render_behavior: required object");
  } else {
    const cropping = (renderBehavior as Record<string, unknown>).cropping_policy;
    const allowedCropping = new Set(["never_crop_product", "allow_small_crop", "allow_crop_if_needed"]);
    if (typeof cropping !== "string" || !allowedCropping.has(cropping)) {
      issues.push(
        `render_behavior.cropping_policy: invalid or missing (allowed: ${Array.from(allowedCropping).join(", ")})`
      );
    }
  }

  const requiredObjects = ["dimensions_cm", "placement", "orientation", "scale", "material_profile"] as const;
  for (const key of requiredObjects) {
    if (!isPlainObject((value as Record<string, unknown>)[key])) {
      issues.push(`${key}: required object`);
    }
  }
  if (!Array.isArray((value as Record<string, unknown>).affordances)) {
    issues.push("affordances: required array");
  }
  if (!Array.isArray((value as Record<string, unknown>).unknowns)) {
    issues.push("unknowns: required array");
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, facts: value as unknown as ProductFacts };
}

export interface ExtractProductFactsInput {
  input: ExtractionInput;
  productAssetId: string;
  shopId: string;
  traceId: string;
}

export async function extractProductFacts(args: ExtractProductFactsInput): Promise<ProductFacts> {
  const { input, productAssetId, shopId, traceId } = args;
  const logContext = createLogContext("prepare", traceId, "extract-start", {
    productTitle: input.title,
  });

  logger.info(logContext, `Starting extraction for: ${input.title}`);

  // Emit resolver started event
  emit({
    shopId,
    requestId: traceId,
    source: EventSource.PREP,
    type: EventType.PROMPT_RESOLVER_STARTED,
    severity: Severity.INFO,
    payload: {
      productTitle: input.title,
      imageCount: input.imageUrls.length,
      model: EXTRACTION_MODEL,
    },
  });

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not set");
  }

  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Resolve prompt from DB
  const resolvedPrompt = await resolvePromptText(shopId, 'product_fact_extractor', {
    title: input.title,
    description: input.description || "(no description)",
    productType: input.productType || "(unknown)",
    vendor: input.vendor || "(unknown)",
    tags: input.tags.join(", ") || "(none)",
    metafields: JSON.stringify(input.metafields, null, 2) || "{}",
  });

  // Build content parts with images
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: resolvedPrompt.promptText },
  ];

  // Prepare images for tracking
  const preparedImages: PreparedImage[] = [];

  // Add up to 3 product images
  for (let i = 0; i < Math.min(input.imageUrls.length, 3); i++) {
    try {
      const response = await fetch(input.imageUrls[i]);
      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        const base64 = buffer.toString("base64");
        const mimeType = response.headers.get("content-type") || "image/jpeg";
        parts.push({
          inlineData: { mimeType, data: base64 },
        });
        preparedImages.push({
          role: 'reference',
          ref: input.imageUrls[i],
          hash: computeImageHash(buffer),
          mimeType,
          inputMethod: 'INLINE',
          orderIndex: i,
        });
      }
    } catch (err) {
      logger.warn(
        { ...logContext, stage: "image-fetch" },
        `Failed to fetch image ${i}: ${err}`
      );
    }
  }

  // Build debug payload
  const debugPayload: DebugPayload = {
    promptText: resolvedPrompt.promptText,
    model: resolvedPrompt.model,
    params: {
      responseModalities: ['TEXT'],
      ...resolvedPrompt.params,
    },
    images: preparedImages,
    aspectRatioSource: 'UNKNOWN',
  };

  // Compute hashes
  const callIdentityHash = computeCallIdentityHash({
    promptText: resolvedPrompt.promptText,
    model: resolvedPrompt.model,
    params: resolvedPrompt.params,
  });
  const dedupeHash = computeDedupeHash({
    callIdentityHash,
    images: preparedImages,
  });

  // Build call summary
  const callSummary: CallSummary = {
    promptName: 'product_fact_extractor',
    model: resolvedPrompt.model,
    imageCount: preparedImages.length,
    promptPreview: resolvedPrompt.promptText.slice(0, 200),
  };

  // Start LLM call tracking
  const callId = await startCall({
    shopId,
    ownerType: 'PRODUCT_ASSET',
    ownerId: productAssetId,
    promptName: 'product_fact_extractor',
    promptVersionId: resolvedPrompt.versionId,
    callIdentityHash,
    dedupeHash,
    callSummary,
    debugPayload,
  });

  const startTime = Date.now();

  try {
    // Retry exactly once on parse/validation failure
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await client.models.generateContent({
        model: resolvedPrompt.model,
        contents: [{ role: "user", parts }],
        config: {
          responseMimeType: "application/json",
        },
      });

      const text = (result as { text?: string })?.text || "{}";

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
            logger.warn({ ...logContext, stage: "validate-retry" }, "Retrying extraction once");
            continue;
          }

          throw new ExtractorOutputError({
            code: "EXTRACTOR_OUTPUT_VALIDATION_FAILED",
            message: "Extractor output failed validation",
            requestId: traceId,
            issues,
            attempt,
          });
        }

        const facts = validated.facts;
        facts.scale_guardrails = deriveScaleGuardrails(facts);

        // Complete LLM call with success
        const latencyMs = Date.now() - startTime;
        const outputSummary: OutputSummary = {
          finishReason: 'STOP',
        };

        await completeCallSuccess({
          callId,
          tokensIn: 0, // TODO: Extract from response
          tokensOut: 0,
          costEstimate: 0,
          latencyMs,
          providerModel: resolvedPrompt.model,
          outputSummary,
        });

        logger.info(
          { ...logContext, stage: "complete" },
          `Extraction complete: ${facts.identity?.product_kind || "unknown"}, scale=${facts.relative_scale?.class}`
        );

        emit({
          shopId,
          requestId: traceId,
          source: EventSource.PREP,
          type: EventType.PROMPT_RESOLVER_COMPLETED,
          severity: Severity.INFO,
          payload: {
            productKind: facts.identity?.product_kind,
            scaleClass: facts.relative_scale?.class,
            materialPrimary: facts.material_profile?.primary,
          },
        });

        return facts;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ ...logContext, stage: "parse", attempt }, `Failed to parse/validate: ${message}`);

        if (attempt === 0) {
          logger.warn({ ...logContext, stage: "parse-retry" }, "Retrying extraction once");
          continue;
        }

        if (err instanceof ExtractorOutputError) {
          throw err;
        }

        throw new ExtractorOutputError({
          code: "EXTRACTOR_OUTPUT_PARSE_FAILED",
          message: "Failed to parse extractor response as JSON",
          requestId: traceId,
          issues: [message],
          attempt,
        });
      }
    }

    throw new Error("Extractor retry loop exhausted unexpectedly");
  } catch (error) {
    // Complete LLM call with failure
    const latencyMs = Date.now() - startTime;
    await completeCallFailure({
      callId,
      latencyMs,
      errorType: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : String(error),
      status: 'FAILED',
    });

    logger.error(logContext, "Extraction failed", error);
    throw error;
  }
}

// =============================================================================
// Legacy Export for backward compatibility
// =============================================================================

/** @deprecated Use extractProductFacts with object argument instead */
export async function extractProductFactsLegacy(
  input: ExtractionInput,
  requestId: string,
  shopId?: string
): Promise<ProductFacts> {
  return extractProductFacts({
    input,
    productAssetId: 'legacy-' + requestId,
    shopId: shopId || 'SYSTEM',
    traceId: requestId,
  });
}
