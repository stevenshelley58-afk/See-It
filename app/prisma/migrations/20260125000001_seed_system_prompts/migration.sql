-- Seed System Prompts Migration
-- This migration populates the prompt_definitions and prompt_control_versions tables
-- with the initial system prompts required for the Prompt Control Plane to function.

-- Step 1: Create SYSTEM shop if it doesn't exist
INSERT INTO shops (id, shop_domain, shopify_shop_id, access_token, plan, monthly_quota, daily_quota, settings_json, created_at)
VALUES (
  'SYSTEM',
  'system.see-it.internal',
  '0',
  'system-internal-token',
  'system',
  0,
  0,
  '{"isSystemTenant": true}',
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Step 2: Create PromptDefinition for 'extractor'
INSERT INTO prompt_definitions (id, shop_id, name, description, default_model, default_params, created_at, updated_at)
VALUES (
  'pd_extractor_system',
  'SYSTEM',
  'extractor',
  'LLM #1: Extract product placement facts from images and text (text+vision model)',
  'gemini-2.5-flash',
  '{"temperature": 0.3, "top_p": 0.95, "max_tokens": 4096}',
  NOW(),
  NOW()
)
ON CONFLICT (shop_id, name) DO NOTHING;

-- Step 3: Create PromptDefinition for 'prompt_builder'
INSERT INTO prompt_definitions (id, shop_id, name, description, default_model, default_params, created_at, updated_at)
VALUES (
  'pd_prompt_builder_system',
  'SYSTEM',
  'prompt_builder',
  'LLM #2: Generate product context and 8 placement variations (text-only model)',
  'gemini-2.5-flash',
  '{"temperature": 0.5, "top_p": 0.95, "max_tokens": 4096}',
  NOW(),
  NOW()
)
ON CONFLICT (shop_id, name) DO NOTHING;

-- Step 4: Create PromptDefinition for 'global_render'
INSERT INTO prompt_definitions (id, shop_id, name, description, default_model, default_params, created_at, updated_at)
VALUES (
  'pd_global_render_system',
  'SYSTEM',
  'global_render',
  'Global rendering rules prepended to all render prompts (image generation model)',
  'gemini-2.5-flash-image',
  '{"temperature": 0.3, "top_p": 0.95, "max_tokens": 8192}',
  NOW(),
  NOW()
)
ON CONFLICT (shop_id, name) DO NOTHING;

-- Step 5: Create PromptVersion v1 ACTIVE for 'extractor'
INSERT INTO prompt_control_versions (id, prompt_definition_id, version, status, system_template, developer_template, user_template, model, params, template_hash, change_notes, created_at, created_by, activated_at, activated_by)
VALUES (
  'pv_extractor_v1',
  'pd_extractor_system',
  1,
  'ACTIVE',
  E'You extract product placement facts for a photorealistic product-in-room rendering system.\n\nExtract as much as possible from the provided text and images.\nIf multiple placement modes are plausible, include them with confidence scores.\nIf something is unknown, mark it unknown — do not guess.\n\nCRITICAL RULES:\n- Do not write marketing copy\n- Do not write prompts\n- Do not invent dimensions or scale\n- Extract relative scale cues only when supported by evidence (title, text, tags, metafields, or obvious visual cues)\n\nRELATIVE SCALE EXTRACTION:\nLook for these keywords and capture them as relative_scale.class with evidence:\n- \"oversized\", \"large\", \"XL\", \"floor mirror\", \"statement piece\" → oversized or large\n- \"petite\", \"tabletop\", \"small\", \"mini\" → small or tiny\n- Standard furniture terms without size modifiers → medium\n\nMATERIAL EXTRACTION:\nBe specific enough to drive render behavior:\n- \"mirror\" vs \"glass\" vs \"reclaimed teak\" vs \"ceramic\" vs \"metal\"\n- Note sheen: matte, satin, gloss\n- Note transparency: opaque, translucent, transparent\n\nReturn ProductPlacementFacts as JSON.',
  NULL,
  E'Product Title: {{title}}\n\nProduct Description:\n{{description}}\n\nProduct Type: {{productType}}\nVendor: {{vendor}}\nTags: {{tags}}\n\nMetafields:\n{{metafields}}\n\nAnalyze the product information and images above. Return ProductPlacementFacts JSON.',
  'gemini-2.5-flash',
  '{"temperature": 0.3, "top_p": 0.95, "max_tokens": 4096}',
  'seed_extractor_v1',
  'Initial version migrated from hardcoded prompts',
  NOW(),
  'system',
  NOW(),
  'system'
)
ON CONFLICT (prompt_definition_id, version) DO NOTHING;

-- Step 6: Create PromptVersion v1 ACTIVE for 'prompt_builder'
INSERT INTO prompt_control_versions (id, prompt_definition_id, version, status, system_template, developer_template, user_template, model, params, template_hash, change_notes, created_at, created_by, activated_at, activated_by)
VALUES (
  'pv_prompt_builder_v1',
  'pd_prompt_builder_system',
  1,
  'ACTIVE',
  E'You write product context and placement variations for a product visualization system.\n\nYou will receive:\n1. resolved_facts: Complete product placement facts\n2. material_rules: Specific rendering rules for this product''s material\n3. variant_intents: The 8 variation strategies you must implement\n\nYOUR OUTPUT:\nYou generate TWO things only:\n1. product_context: A paragraph describing the product for the rendering system\n2. variants: An array of 8 objects, each with id and variation text\n\nYOU DO NOT GENERATE:\n- Global rules (these are hardcoded separately)\n- Image handling instructions\n- Aspect ratio rules\n- Room preservation rules\n\nPRODUCT_CONTEXT REQUIREMENTS:\n- Describe the product''s visual identity, materials, and character\n- Include the material rendering rules provided\n- MUST include this exact line: \"Relative scale: {scale_guardrails}\"\n- Keep it factual and specific, not marketing copy\n\nVARIATION REQUIREMENTS:\n- Each variation describes WHERE and HOW to place the product\n- Each variation MUST include a short camera/framing clause (1-2 sentences) describing viewpoint/framing consistency (camera height, perspective, lens look, and depth of field) relative to customer_room_image\n- Follow the intent and scale strategy specified for each variant ID\n- V01, V04, V06 must reference a specific in-frame scale anchor\n- V02 must be 15-25% smaller than V01\n- V03 must be 15-25% larger than V01\n- V05 must be 15-25% smaller than V04\n- V07 emphasizes multiple scale references\n- V08 is the conservative escape hatch\n\nOutput JSON only:\n{\n  \"product_context\": \"string\",\n  \"variants\": [\n    { \"id\": \"V01\", \"variation\": \"string\" },\n    { \"id\": \"V02\", \"variation\": \"string\" },\n    { \"id\": \"V03\", \"variation\": \"string\" },\n    { \"id\": \"V04\", \"variation\": \"string\" },\n    { \"id\": \"V05\", \"variation\": \"string\" },\n    { \"id\": \"V06\", \"variation\": \"string\" },\n    { \"id\": \"V07\", \"variation\": \"string\" },\n    { \"id\": \"V08\", \"variation\": \"string\" }\n  ]\n}',
  NULL,
  E'RESOLVED FACTS:\n{{resolvedFactsJson}}\n\nMATERIAL RULES FOR {{materialPrimary}}:\n{{materialRules}}\n\nSCALE GUARDRAILS (must include verbatim in product_context):\n{{scaleGuardrails}}\n\nVARIANT INTENTS:\n{{variantIntentsJson}}\n\nGenerate product_context and 8 variations following the intents exactly.',
  'gemini-2.5-flash',
  '{"temperature": 0.5, "top_p": 0.95, "max_tokens": 4096}',
  'seed_prompt_builder_v1',
  'Initial version migrated from hardcoded prompts',
  NOW(),
  'system',
  NOW(),
  'system'
)
ON CONFLICT (prompt_definition_id, version) DO NOTHING;

-- Step 7: Create PromptVersion v1 ACTIVE for 'global_render'
INSERT INTO prompt_control_versions (id, prompt_definition_id, version, status, system_template, developer_template, user_template, model, params, template_hash, change_notes, created_at, created_by, activated_at, activated_by)
VALUES (
  'pv_global_render_v1',
  'pd_global_render_system',
  1,
  'ACTIVE',
  E'You are compositing a product into a customer''s room photo for ecommerce visualization.\n\nIMAGE ROLES\n- prepared_product_image: The product with transparent background. This is the exact item being sold.\n- customer_room_image: The customer''s real room photo. This must be preserved exactly.\n\nMANDATORY RULES\n\n0. COMPOSITION: Place the product from prepared_product_image into customer_room_image. The room remains the base image.\n\n0b. LIGHTING MATCH: Match direction, softness, intensity, and color temperature of the room light. Ensure the product''s contact shadow matches room cues.\n\n0c. PHOTOGRAPHIC MATCH: Match the room photo''s camera height and perspective. Match lens look and depth of field behavior to the room.\n\n0d. PRESERVATION:\nDo not redesign the product. Preserve exact geometry, proportions, materials, texture, and color.\n\n1. ASPECT RATIO: Output must match the aspect ratio and full frame of customer_room_image exactly.\n\n2. ROOM PRESERVATION: Change only what is required to realistically insert the product into customer_room_image. Keep everything else exactly the same — geometry, furnishings, colors, lighting, objects.\n\n3. SINGLE COMPOSITE: Output a single photoreal image of customer_room_image with the product added naturally. Not a collage. Not a split view. Not a new room. Not a background swap.\n\n4. SCALE DOWN, NEVER CROP: If the product would be cut off by the frame, reduce its scale slightly until the entire product is visible. Do not crop the product.\n\n5. BACKGROUND DISCARD: The transparent background of prepared_product_image must be completely discarded. Only the product itself appears in the output.\n\n6. IDENTITY PRESERVATION: Preserve the exact character of the product — natural patina, wood grain variations, surface imperfections, weathering marks. These are features, not flaws. Do not smooth, polish, or idealize.\n\n7. NO INVENTED HARDWARE: For mirrors and framed items, preserve the exact frame, mounting hardware, and edge details from prepared_product_image. Do not add, remove, or modify hardware.\n\n8. PHYSICAL REALISM: Correct perspective matching the room''s camera angle. Accurate shadows based on room lighting. Proper occlusion where the product meets room surfaces. Reflections consistent with room environment (for reflective materials).\n\n9. NO STYLIZATION: No filters, color grading, vignettes, or artistic effects. No text or logos.\n\nReturn only the final composed image.',
  NULL,
  NULL,
  'gemini-2.5-flash-image',
  '{"temperature": 0.3, "top_p": 0.95, "max_tokens": 8192}',
  'seed_global_render_v1',
  'Initial version migrated from hardcoded prompts',
  NOW(),
  'system',
  NOW(),
  'system'
)
ON CONFLICT (prompt_definition_id, version) DO NOTHING;
