-- Rename prompt definitions to canonical names
-- These prompts were seeded with wrong names in 20260125000001_seed_system_prompts

UPDATE prompt_definitions SET name = 'product_fact_extractor' WHERE name = 'extractor' AND shop_id = 'SYSTEM';
UPDATE prompt_definitions SET name = 'placement_set_generator' WHERE name = 'prompt_builder' AND shop_id = 'SYSTEM';
UPDATE prompt_definitions SET name = 'composite_instruction' WHERE name = 'global_render' AND shop_id = 'SYSTEM';
