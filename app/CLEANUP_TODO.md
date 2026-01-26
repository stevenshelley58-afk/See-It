# See It Now Cleanup - Files to Delete

## DELETE THESE FILES (Old/Duplicate Code)

### 1. Old Prompt Generator (replaced by 2-LLM pipeline)
```
DELETE: app/services/see-it-now-prompt-generator.server.ts
```
Reason: Replaced by:
- `app/services/see-it-now/extractor.server.ts` (LLM #1)
- `app/services/see-it-now/prompt-builder.server.ts` (LLM #2)

### 2. Old Variant Config (replaced by controlled probes)
```
DELETE: app/config/see-it-now-variants.config.ts
```
Reason: Old 10-variant creative system replaced by:
- `app/config/prompts/variant-intents.config.ts` (V01-V08 controlled probes)

## KEEP THESE FILES (New 2-LLM Pipeline)

### Services
- `app/services/see-it-now/index.ts` - Exports
- `app/services/see-it-now/types.ts` - Type definitions
- `app/services/see-it-now/extractor.server.ts` - LLM #1 (ProductFacts)
- `app/services/see-it-now/resolver.server.ts` - Merge extracted + merchant overrides
- `app/services/see-it-now/prompt-builder.server.ts` - LLM #2 (PlacementSet)
- `app/services/see-it-now/prompt-assembler.server.ts` - Deterministic concatenation
- `app/services/see-it-now/renderer.server.ts` - 8 parallel renders
- `app/services/see-it-now/monitor.server.ts` - CompositeRun/CompositeVariant logging
- `app/services/see-it-now/versioning.server.ts` - Prompt version tracking

### Config
- `app/config/prompts/global-render.prompt.ts` - GLOBAL_RENDER_STATIC
- `app/config/prompts/extractor.prompt.ts` - LLM #1 system prompt
- `app/config/prompts/prompt-builder.prompt.ts` - LLM #2 system prompt
- `app/config/prompts/variant-intents.config.ts` - V01-V08 controlled probes
- `app/config/prompts/material-behaviors.config.ts` - Material-specific rules
- `app/config/prompts/scale-guardrails.config.ts` - Scale guardrail templates
- `app/config/schemas/product-facts.schema.ts` - Gemini structured output schema

### Routes
- `app/routes/app-proxy.see-it-now.render.ts` - Updated render endpoint
- `app/routes/app.monitor.tsx` - Monitor UI
- `app/routes/api.monitor.run.$id.tsx` - Monitor API

## RUN AFTER DELETING

```bash
# Remove old files
rm app/services/see-it-now-prompt-generator.server.ts
rm app/config/see-it-now-variants.config.ts

# Verify no remaining imports
grep -r "see-it-now-prompt-generator" app/
grep -r "see-it-now-variants.config" app/
```
