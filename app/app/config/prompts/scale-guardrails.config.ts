/**
 * Scale Guardrails
 *
 * These are derived from resolved_facts and injected into product_context.
 * They prevent oversized items from collapsing to decor scale.
 */

export interface ScaleGuardrailTemplate {
  class: string;
  template: string;
}

export const SCALE_GUARDRAIL_TEMPLATES: Record<string, ScaleGuardrailTemplate> =
  {
    architectural: {
      class: "architectural",
      template:
        "Architectural scale — should relate to room structure (ceiling height, wall spans) and be clearly larger than standard furniture.",
    },
    oversized: {
      class: "oversized",
      template:
        "Oversized — should visually dominate its placement area and be clearly larger than typical furniture pieces like dining chairs or side tables.",
    },
    large: {
      class: "large",
      template:
        "Large furniture scale — should be comparable to major furniture pieces (sofas, dining tables, beds) in the room.",
    },
    medium: {
      class: "medium",
      template:
        "Medium furniture scale — should be comparable to chairs, side tables, or small cabinets.",
    },
    small: {
      class: "small",
      template:
        "Small scale — should be noticeably smaller than chairs, appropriate for tabletops or shelves.",
    },
    tiny: {
      class: "tiny",
      template:
        "Tiny/decor scale — small enough to sit on a tabletop or shelf alongside other objects.",
    },
    unknown: {
      class: "unknown",
      template:
        "Size the product to look plausible for its product kind, using nearby furniture as scale reference.",
    },
  };

/**
 * Derive scale guardrails text from resolved facts
 */
export function deriveScaleGuardrails(facts: {
  identity?: { product_kind?: string | null };
  relative_scale?: { class?: string | null };
  dimensions_cm?: { h?: number | null; w?: number | null };
}): string {
  const scaleClass = facts.relative_scale?.class || "unknown";
  const template =
    SCALE_GUARDRAIL_TEMPLATES[scaleClass] || SCALE_GUARDRAIL_TEMPLATES.unknown;

  let guardrail = template.template;

  // Add dimension context if available
  const h = facts.dimensions_cm?.h;
  const w = facts.dimensions_cm?.w;
  if (h && w) {
    guardrail += ` Approximate dimensions: ${h}cm tall × ${w}cm wide.`;
  } else if (h) {
    guardrail += ` Approximate height: ${h}cm.`;
  } else if (w) {
    guardrail += ` Approximate width: ${w}cm.`;
  }

  // Add product kind context
  const kind = facts.identity?.product_kind;
  if (kind) {
    guardrail = `${kind}: ${guardrail}`;
  }

  return guardrail;
}
