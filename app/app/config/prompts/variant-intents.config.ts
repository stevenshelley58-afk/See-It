import type { VariantIntent } from "~/services/see-it-now/types";

/**
 * V01-V08 Controlled Bracket
 *
 * These define the 8 coverage probes. They are NOT creative variations.
 * They systematically explore placement and scale to reduce failures.
 */

export const VARIANT_INTENTS: VariantIntent[] = [
  {
    id: "V01",
    intent: "Primary expected placement, best-guess scale, no crop",
    placementMode: "primary",
    scaleStrategy: "best-guess",
    scaleNote:
      "Size based on resolved_facts dimensions if known, otherwise use scale_guardrails relative to room anchors.",
    anchorRule:
      "Choose the nearest strong in-frame scale reference (doorway, sofa, chair, benchtop, bed) and size the product relative to it per scale_guardrails.",
  },
  {
    id: "V02",
    intent: "Same placement as V01, conservative scale",
    placementMode: "primary",
    scaleStrategy: "smaller",
    scaleNote:
      "15-25% smaller than V01. Must be visibly smaller but still plausible.",
    anchorRule: "Use same anchor as V01.",
  },
  {
    id: "V03",
    intent: "Same placement as V01, bold scale",
    placementMode: "primary",
    scaleStrategy: "larger",
    scaleNote:
      "15-25% larger than V01. Must be visibly larger but still plausible.",
    anchorRule: "Use same anchor as V01.",
  },
  {
    id: "V04",
    intent: "Secondary valid placement mode, best-guess scale",
    placementMode: "secondary",
    scaleStrategy: "best-guess",
    scaleNote:
      "Same scale logic as V01, applied to a different valid placement location.",
    anchorRule:
      "Choose the nearest strong in-frame scale reference for this alternate location and size relative to it.",
  },
  {
    id: "V05",
    intent: "Secondary placement, conservative scale",
    placementMode: "secondary",
    scaleStrategy: "smaller",
    scaleNote:
      "15-25% smaller than V04. Must be visibly smaller but still plausible.",
    anchorRule: "Use same anchor as V04.",
  },
  {
    id: "V06",
    intent: "Alternative room anchor point, best-guess scale",
    placementMode: "alternative",
    scaleStrategy: "best-guess",
    scaleNote:
      "Same scale logic as V01, but using a different reference point in the room.",
    anchorRule:
      "Choose a DIFFERENT anchor than V01/V04 (different wall, different furniture piece) and size relative to it.",
  },
  {
    id: "V07",
    intent: "Context-heavy framing for strong scale cues",
    placementMode: "primary",
    scaleStrategy: "context-heavy",
    scaleNote:
      "Place near multiple visible scale references to maximize scale accuracy. Do not change viewpoint.",
    anchorRule:
      "Use multiple in-frame anchors (at least two: e.g., sofa + doorway, chair + table, bed + nightstand). State the product's size relative to each anchor per scale_guardrails.",
  },
  {
    id: "V08",
    intent: "Escape hatch: maximum realism, conservative scale",
    placementMode: "primary",
    scaleStrategy: "conservative",
    scaleNote:
      "Prioritize believability over everything. Choose conservative scale if uncertain. Strictest preservation rules.",
    anchorRule: null, // Special: whatever produces most realistic result
  },
];

/**
 * Get variant intents as JSON string for LLM input
 */
export function getVariantIntentsForPrompt(): string {
  return JSON.stringify(
    VARIANT_INTENTS.map((v) => ({
      id: v.id,
      intent: v.intent,
      scaleNote: v.scaleNote,
      anchorRule:
        v.anchorRule || "Choose placement and scale for maximum realism.",
    })),
    null,
    2
  );
}
