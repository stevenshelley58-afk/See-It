import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useFetcher } from '@remix-run/react';
import { Button } from '../ui';

/**
 * PlacementTab - Product preparation for rendering
 * 
 * Flow:
 * 1. Auto-extract structured fields from product data
 * 2. Merchant reviews/adjusts fields
 * 3. Click "Generate Description" → AI writes optimized prose
 * 4. Merchant sees description with "edit at own risk" warning
 * 5. Save → prose goes to ProductAsset.renderInstructions
 */

// ============================================================================
// HELPERS
// ============================================================================

function stripHtml(input) {
    if (!input) return '';
    return String(input)
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&times;/gi, '×')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

function flattenMetafields(product) {
    const edges = product?.metafields?.edges;
    if (!Array.isArray(edges)) return [];
    return edges.map(e => e?.node).filter(Boolean);
}

function extractDimsFromText(rawText) {
    const text = (rawText || '').toString();
    if (!text) return { height: null, width: null };

    // Try JSON-ish values first (common when metafields store structured data)
    // e.g. {"height":180,"width":95} or {"h":180,"w":95}
    try {
        const maybeJson = text.trim();
        if (maybeJson.startsWith('{') && maybeJson.endsWith('}')) {
            const parsed = JSON.parse(maybeJson);
            const h = parsed.height ?? parsed.h ?? parsed.Height ?? null;
            const w = parsed.width ?? parsed.w ?? parsed.Width ?? null;
            const height = typeof h === 'number' ? h : (typeof h === 'string' ? parseFloat(h) : null);
            const width = typeof w === 'number' ? w : (typeof w === 'string' ? parseFloat(w) : null);
            if (Number.isFinite(height) || Number.isFinite(width)) {
                return {
                    height: Number.isFinite(height) ? height : null,
                    width: Number.isFinite(width) ? width : null,
                };
            }
        }
    } catch {
        // ignore
    }

    // Common patterns:
    // - "180 x 95" (assume cm)
    // - "180cm x 95cm"
    // - "H: 180cm W: 95cm"
    // - "Height 180 Width 95"
    // - "180×95"
    const cross = text.match(/(\d{2,4}(?:\.\d+)?)\s*(?:cm|mm|")?\s*[x×]\s*(\d{2,4}(?:\.\d+)?)\s*(?:cm|mm|")?/i);
    if (cross) {
        return { height: parseFloat(cross[1]), width: parseFloat(cross[2]) };
    }

    const heightMatch = text.match(/\b(h(?:eight)?)\s*[:\-]?\s*(\d{2,4}(?:\.\d+)?)\s*(cm|mm|")?\b/i);
    const widthMatch = text.match(/\b(w(?:idth)?)\s*[:\-]?\s*(\d{2,4}(?:\.\d+)?)\s*(cm|mm|")?\b/i);
    if (heightMatch || widthMatch) {
        return {
            height: heightMatch ? parseFloat(heightMatch[2]) : null,
            width: widthMatch ? parseFloat(widthMatch[2]) : null,
        };
    }

    return { height: null, width: null };
}

function extractDimsFromMetafields(product) {
    const metas = flattenMetafields(product);
    if (!metas.length) return { height: null, width: null };

    // Prefer metafields likely to contain dimensions/measurements
    const candidates = metas.filter(m => {
        const key = `${m.namespace || ''}.${m.key || ''}`.toLowerCase();
        return (
            key.includes('dimension') ||
            key.includes('dimensions') ||
            key.includes('measurement') ||
            key.includes('measurements') ||
            key.includes('size')
        );
    });

    const ordered = candidates.length ? candidates : metas;
    for (const m of ordered) {
        const val = stripHtml(m.value || '');
        const dims = extractDimsFromText(val);
        if (dims.height || dims.width) return dims;
    }

    return { height: null, width: null };
}

// Auto-detect fields from product title/description (client-side quick version)
function autoDetectFields(product) {
    const descriptionText = stripHtml(product.description || product.descriptionHtml || '');
    const metafieldText = flattenMetafields(product).map(m => stripHtml(m.value || '')).join(' ');
    const tagsText = Array.isArray(product.tags) ? product.tags.join(' ') : (product.tags || '');
    // Important: split "label" vs "context" so we don't misclassify placement based on
    // sentences like "style it on a table" inside the description.
    const labelText = `${product.title} ${tagsText} ${product.productType || ''} ${product.vendor || ''}`.toLowerCase();
    const contextText = `${descriptionText} ${metafieldText}`.toLowerCase();
    const allText = `${labelText} ${contextText}`.toLowerCase();
    
    // Surface detection
    const surfaceKeywords = {
        // NOTE: do NOT include ambiguous words like "table" here because descriptions
        // frequently mention a surface the item can be styled on.
        floor: ['sofa', 'couch', 'chair', 'bed', 'dresser', 'cabinet', 'bookshelf', 'rug', 'carpet', 'bench', 'ottoman'],
        wall: ['mirror', 'art', 'painting', 'print', 'poster', 'frame', 'canvas', 'clock', 'sconce', 'wall', 'wall-mounted', 'wall mount', 'wall hung', 'wall-hung'],
        table: ['lamp', 'vase', 'planter', 'pot', 'candle', 'sculpture', 'figurine', 'bowl', 'tray', 'ornament', 'caddy'],
        ceiling: ['pendant', 'chandelier', 'hanging', 'ceiling'],
        shelf: ['shelf', 'bookcase shelf', 'floating shelf'],
    };

    const mentionsTableSurface =
        /\btabletop\b/i.test(contextText) ||
        /\btable-top\b/i.test(contextText) ||
        /\bon (a|the) table\b/i.test(contextText) ||
        /\bon (a|the) side table\b/i.test(contextText) ||
        /\bon (a|the) coffee table\b/i.test(contextText) ||
        /\bon (a|the) console table\b/i.test(contextText) ||
        /\bconsole table\b/i.test(contextText) ||
        // last-resort: "table" in context text (common on Shopify PDPs)
        /\btable\b/i.test(contextText);

    // If the PRODUCT itself is a table/desk/console, that's a floor item.
    const isFloorFurnitureByLabel =
        /\btable\b/i.test(labelText) ||
        /\bdesk\b/i.test(labelText) ||
        /\bconsole\b/i.test(labelText) ||
        /\bcredenza\b/i.test(labelText) ||
        /\bsideboard\b/i.test(labelText);

    let surface = 'floor';

    // Prefer explicit categories first
    if (surfaceKeywords.ceiling.some(k => allText.includes(k))) {
        surface = 'ceiling';
    } else if (surfaceKeywords.wall.some(k => allText.includes(k))) {
        surface = 'wall';
    } else if (surfaceKeywords.table.some(k => allText.includes(k))) {
        surface = 'table';
    } else if (surfaceKeywords.shelf.some(k => allText.includes(k))) {
        surface = 'shelf';
    } else if (isFloorFurnitureByLabel) {
        surface = 'floor';
    } else if (mentionsTableSurface) {
        // If the description says "on a table"/"tabletop", treat as a tabletop item
        // unless the label indicates it's actually a table/desk/console itself.
        surface = 'table';
    } else if (surfaceKeywords.floor.some(k => allText.includes(k))) {
        surface = 'floor';
    }
    
    // Material detection
    const materialKeywords = {
        fabric: ['fabric', 'velvet', 'linen', 'cotton', 'wool', 'upholstered', 'sofa', 'couch', 'chair', 'cushion'],
        wood: ['wood', 'oak', 'walnut', 'teak', 'pine', 'bamboo', 'rattan'],
        metal: ['metal', 'steel', 'iron', 'brass', 'copper', 'chrome', 'gold', 'silver'],
        glass: ['glass', 'crystal', 'mirror', 'transparent'],
        ceramic: ['ceramic', 'porcelain', 'pottery', 'terracotta'],
        stone: ['stone', 'marble', 'granite', 'concrete'],
        leather: ['leather', 'suede'],
    };
    
    let material = 'mixed';
    for (const [mat, keywords] of Object.entries(materialKeywords)) {
        if (keywords.some(k => allText.includes(k))) {
            material = mat;
            break;
        }
    }
    
    // Orientation
    let orientation = 'upright';
    if (allText.includes('rug') || allText.includes('carpet')) {
        orientation = 'flat';
    } else if ((allText.includes('mirror') || allText.includes('art')) && surface === 'floor') {
        orientation = 'leaning';
    } else if (surface === 'wall') {
        orientation = 'wall-mounted';
    } else if (surface === 'ceiling') {
        orientation = 'hanging';
    }
    
    // Dimensions from description
    // Pull from metafields first (if present), else from description/descriptionHtml.
    let dimensions = extractDimsFromMetafields(product);
    if (!dimensions.height && !dimensions.width) {
        dimensions = extractDimsFromText(descriptionText);
    }
    
    // Placement rules: auto-detect defaults
    // Large items (sofas, mirrors, cabinets) → Dominant + Similar Size or Position + Yes
    // Small items (lamps, decor) → Integrated + None + No
    // Use labelText to avoid false positives from descriptions like "style it on a console table".
    const largeItemKeywords = ['sofa', 'couch', 'sectional', 'mirror', 'cabinet', 'dresser', 'bookshelf', 'bed', 'table', 'desk', 'console', 'credenza', 'sideboard'];
    const isLargeItem = largeItemKeywords.some(k => labelText.includes(k));
    
    const sceneRole = isLargeItem ? 'Dominant' : 'Integrated';
    const replacementRule = isLargeItem ? 'Similar Size or Position' : 'None';
    const allowSpaceCreation = isLargeItem;
    
    return { surface, material, orientation, dimensions, sceneRole, replacementRule, allowSpaceCreation };
}

function createBestGuessDescription(product, fields) {
    const title = (product?.title || '').toString().trim() || 'product';
    const article = /^[aeiou]/i.test(title) ? 'An' : 'A';

    const material =
        fields?.material && fields.material !== 'other' ? fields.material : null;

    const height = fields?.dimensions?.height;
    const width = fields?.dimensions?.width;
    const sizeBits = [];
    if (height) sizeBits.push(`${height}cm tall`);
    if (width) sizeBits.push(`${width}cm wide`);
    const sizeSentence = sizeBits.length ? ` It measures approximately ${sizeBits.join(' and ')}.` : '';

    const notes = (fields?.additionalNotes || '').toString().trim();
    const notesSentence = notes ? ` Notable details: ${notes}.` : '';

    // Keep it usable for AI/photography without forcing placement instructions.
    return `${article} ${title}${material ? ` primarily in ${material}` : ''}, described for realistic interior photography with accurate proportions and natural lighting.${sizeSentence}${notesSentence}`.trim();
}

// ============================================================================
// SEE IT NOW PER-PRODUCT VARIANT DEFAULTS (client-side only)
// Mirrors the server archetype priority map so "Reset to Defaults" is instant.
// ============================================================================

const SEE_IT_NOW_VARIATION_PROMPTS = {
    1: "Place the product in the most obvious and conventional location where this type of product would naturally belong, scaled realistically.",
    2: "Place the product in a different but still natural location, scaled realistically.",
    3: "Place the product in an accommodating location, scaled slightly smaller than typical so it feels comfortably fitted.",
    4: "Place the product in a plausible secondary location, scaled accurately to real-world proportions.",
    5: "Place the product in a strong location, scaled slightly larger than typical so it feels intentionally sized.",
    6: "Place the product in a different natural location, scaled larger than a standard version would normally be.",
    7: "Place the product in a clear, visually strong area where it can act as a focal point.",
    8: "Place the product near existing elements in an integrated way, allowing proximity or partial occlusion if natural.",
    9: "Place the product in a less central but appropriate location, prioritizing subtlety.",
    10: "Choose the location and scale most likely to result in a believable real photograph.",
};

const SEE_IT_NOW_ARCHETYPE_VARIATIONS = {
    oversized_architectural: { primary: [5, 6, 7, 10], secondary: [1, 2] },
    large_furniture: { primary: [1, 4, 5, 10], secondary: [2, 8] },
    medium_furniture: { primary: [1, 4, 8, 10], secondary: [2, 3] },
    small_homewares: { primary: [3, 8, 9, 10], secondary: [1, 2] },
    wall_mounted_decor: { primary: [1, 2, 4, 10], secondary: [8, 9] },
};

function buildDefaultSeeItNowVariants(archetype) {
    const cfg = SEE_IT_NOW_ARCHETYPE_VARIATIONS[archetype];
    if (!cfg) return [];
    const numbers = [...(cfg.primary || []), ...((cfg.secondary || []).slice(0, 2))];
    return numbers
        .filter((n) => SEE_IT_NOW_VARIATION_PROMPTS[n])
        .map((n) => ({ id: `variation_${n}`, prompt: SEE_IT_NOW_VARIATION_PROMPTS[n] }));
}

// ============================================================================
// COMPONENT
// ============================================================================

export function PlacementTab({ product, asset, onChange }) {
    const fetcher = useFetcher();
    
    // Parse existing saved description (if any)
    const existingDescription = useMemo(() => {
        if (!asset?.renderInstructions) return null;
        // If it starts with {, it's old JSON format - ignore it
        if (asset.renderInstructions.startsWith('{')) return null;
        return asset.renderInstructions;
    }, [asset]);
    
    // Auto-detect initial fields (fallback if no saved data)
    const detectedFields = useMemo(() => autoDetectFields(product), [product]);
    
    // Load saved placementFields from asset, or use auto-detected defaults
    const initialFields = useMemo(() => {
        if (asset?.placementFields && typeof asset.placementFields === 'object') {
            // Use saved placementFields if available
            const saved = asset.placementFields;
            return {
                surface: saved.surface || detectedFields.surface,
                material: saved.material || detectedFields.material,
                orientation: saved.orientation || detectedFields.orientation,
                shadow: saved.shadow || (detectedFields.surface === 'ceiling' ? 'none' : 'contact'),
                dimensions: saved.dimensions || detectedFields.dimensions || { height: null, width: null },
                additionalNotes: saved.additionalNotes || '',
            };
        }
        // Fallback to auto-detection
        return {
            surface: detectedFields.surface,
            material: detectedFields.material,
            orientation: detectedFields.orientation,
            shadow: detectedFields.surface === 'ceiling' ? 'none' : 'contact',
            dimensions: detectedFields.dimensions || { height: null, width: null },
            additionalNotes: '',
        };
    }, [asset?.placementFields, detectedFields]);
    
    // State
    const [fields, setFields] = useState(initialFields);
    
    // Update state when asset.placementFields changes (e.g., asset loads async)
    useEffect(() => {
        if (asset?.placementFields && typeof asset.placementFields === 'object') {
            const saved = asset.placementFields;
            setFields(prev => ({
                surface: saved.surface || prev.surface,
                material: saved.material || prev.material,
                orientation: saved.orientation || prev.orientation,
                shadow: saved.shadow || prev.shadow,
                dimensions: saved.dimensions || prev.dimensions || { height: null, width: null },
                additionalNotes: saved.additionalNotes !== undefined ? saved.additionalNotes : prev.additionalNotes,
            }));
        }
    }, [asset?.placementFields]);
    
    // placement rules state - use existing asset values or auto-detected defaults
    const [placementRulesFields, setPlacementRulesFields] = useState({
        sceneRole: asset?.sceneRole || detectedFields.sceneRole || null,
        replacementRule: asset?.replacementRule || detectedFields.replacementRule || null,
        allowSpaceCreation: asset?.allowSpaceCreation !== undefined ? asset.allowSpaceCreation : detectedFields.allowSpaceCreation,
    });
    
    // Update placementRulesFields when asset loads async
    useEffect(() => {
        if (asset) {
            setPlacementRulesFields({
                sceneRole: asset.sceneRole || detectedFields.sceneRole || null,
                replacementRule: asset.replacementRule || detectedFields.replacementRule || null,
                allowSpaceCreation: asset.allowSpaceCreation !== undefined ? asset.allowSpaceCreation : detectedFields.allowSpaceCreation,
            });
        }
    }, [asset?.sceneRole, asset?.replacementRule, asset?.allowSpaceCreation, detectedFields]);
    
    const [description, setDescription] = useState(existingDescription || '');
    const [isGenerating, setIsGenerating] = useState(false);
    const [hasEdited, setHasEdited] = useState(false);
    const [showEditWarning, setShowEditWarning] = useState(false);

    // See It Now prompt state (with dirty tracking)
    const [seeItNowPrompt, setSeeItNowPrompt] = useState(asset?.renderInstructionsSeeItNow || '');
    const [seeItNowDirty, setSeeItNowDirty] = useState(false);

    // See It Now generated prompt state
    const [generatedSeeItNowPrompt, setGeneratedSeeItNowPrompt] = useState(asset?.generatedSeeItNowPrompt || '');
    const [generatedPromptDirty, setGeneratedPromptDirty] = useState(false);
    const [seeItNowVariants, setSeeItNowVariants] = useState(() => {
        if (asset?.seeItNowVariants && Array.isArray(asset.seeItNowVariants)) {
            return asset.seeItNowVariants;
        }
        return [];
    });
    const [variantsDirty, setVariantsDirty] = useState(false);
    const [detectedArchetype, setDetectedArchetype] = useState(asset?.detectedArchetype || null);
    const [useGeneratedPrompt, setUseGeneratedPrompt] = useState(asset?.useGeneratedPrompt || false);
    const [isRegenerating, setIsRegenerating] = useState(false);

    // Sync generated prompt state when asset loads async
    useEffect(() => {
        if (!generatedPromptDirty && asset?.generatedSeeItNowPrompt) {
            const assetValue = asset.generatedSeeItNowPrompt;
            setGeneratedSeeItNowPrompt((prev) => {
                const prevTrim = (prev || '').toString().trim();
                if (prevTrim) return prev;
                return assetValue;
            });
        }
        if (!variantsDirty && asset?.seeItNowVariants && Array.isArray(asset.seeItNowVariants) && asset.seeItNowVariants.length > 0) {
            const assetVariants = asset.seeItNowVariants;
            setSeeItNowVariants((prev) => {
                if (Array.isArray(prev) && prev.length > 0) return prev;
                return assetVariants;
            });
        }
        if (asset?.detectedArchetype) {
            setDetectedArchetype((prev) => prev || asset.detectedArchetype);
        }
        if (asset?.useGeneratedPrompt !== undefined) {
            setUseGeneratedPrompt(asset.useGeneratedPrompt);
        }
    }, [asset?.generatedSeeItNowPrompt, asset?.seeItNowVariants, asset?.detectedArchetype, asset?.useGeneratedPrompt, generatedPromptDirty, variantsDirty]);

    // Enable toggle state
    const [enabled, setEnabled] = useState(asset?.enabled || false);

    // Sync enabled state with asset prop changes
    useEffect(() => {
        setEnabled(asset?.enabled || false);
    }, [asset?.enabled]);

    // Hydrate missing dimensions from server-side extraction (Shopify descriptionHtml + metafields).
    // This runs once per product open and only fills dims if the current dims are empty.
    useEffect(() => {
        let cancelled = false;
        const numericId = product?.id ? String(product.id).split('/').pop() : null;
        if (!numericId) return;
        if (fields?.dimensions?.height || fields?.dimensions?.width) return;

        (async () => {
            try {
                const res = await fetch(`/api/products/generate-description?productId=${encodeURIComponent(numericId)}`);
                const data = await res.json().catch(() => null);
                const suggested = data?.suggestedFields;
                if (!res.ok || !suggested || cancelled) return;

                const h = suggested?.dimensions?.height;
                const w = suggested?.dimensions?.width;
                if (!h && !w) return;

                setFields(prev => {
                    // only fill if still empty
                    const prevH = prev?.dimensions?.height;
                    const prevW = prev?.dimensions?.width;
                    if (prevH || prevW) return prev;
                    return {
                        ...prev,
                        dimensions: {
                            height: typeof h === 'number' ? h : (typeof h === 'string' ? parseFloat(h) : null),
                            width: typeof w === 'number' ? w : (typeof w === 'string' ? parseFloat(w) : null),
                        }
                    };
                });
            } catch {
                // silent: never break merchant UI
            }
        })();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [product?.id]);

    // If the asset loads async and contains a saved description, hydrate it into local state.
    useEffect(() => {
        if (!existingDescription) return;
        setDescription((prev) => {
            const prevTrim = (prev || '').toString().trim();
            if (prevTrim) return prev;
            return existingDescription;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [existingDescription]);

    // Hydrate See It Now prompt when asset loads async (only if not dirty)
    useEffect(() => {
        if (seeItNowDirty) return;
        const assetValue = asset?.renderInstructionsSeeItNow || '';
        setSeeItNowPrompt((prev) => {
            const prevTrim = (prev || '').toString().trim();
            if (prevTrim) return prev;
            return assetValue;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [asset?.renderInstructionsSeeItNow]);
    
    // Notify parent when description, placementFields, placement rules, See It Now prompt, or enabled change
    useEffect(() => {
        if (onChange) {
            // Pass renderInstructions (placement prompt), placementFields, placement rules config, See It Now prompt, and enabled
            onChange({
                renderInstructions: description || null,
                renderInstructionsSeeItNow: seeItNowPrompt,
                renderInstructionsSeeItNowDirty: seeItNowDirty,
                placementFields: {
                    surface: fields.surface,
                    material: fields.material,
                    orientation: fields.orientation,
                    shadow: fields.shadow,
                    dimensions: fields.dimensions || { height: null, width: null },
                    additionalNotes: fields.additionalNotes || '',
                },
                placementRulesConfig: {
                    sceneRole: placementRulesFields.sceneRole || null,
                    replacementRule: placementRulesFields.replacementRule || null,
                    allowSpaceCreation: placementRulesFields.allowSpaceCreation !== undefined ? placementRulesFields.allowSpaceCreation : null,
                },
                generatedSeeItNowPrompt: generatedPromptDirty ? generatedSeeItNowPrompt : undefined,
                seeItNowVariants: variantsDirty ? seeItNowVariants : undefined,
                useGeneratedPrompt: useGeneratedPrompt,
                enabled: enabled
            });
        }
    }, [description, seeItNowPrompt, seeItNowDirty, fields, placementRulesFields, enabled, generatedSeeItNowPrompt, generatedPromptDirty, seeItNowVariants, variantsDirty, useGeneratedPrompt, onChange]);
    
    // Update a field
    const updateField = useCallback((field, value) => {
        setFields(prev => {
            if (field.includes('.')) {
                const [parent, child] = field.split('.');
                return {
                    ...prev,
                    [parent]: { ...prev[parent], [child]: value }
                };
            }
            return { ...prev, [field]: value };
        });
    }, []);
    
    // Generate description via API
    const handleGenerate = useCallback(async () => {
        setIsGenerating(true);
        setShowEditWarning(false);
        
        try {
            const response = await fetch('/api/products/generate-description', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product: {
                        title: product.title,
                        description: product.description || product.descriptionHtml,
                        productType: product.productType,
                        tags: product.tags,
                    },
                    fields: fields,
                }),
            });
            
            const data = await response.json();
            
            if (data.success && data.description) {
                setDescription(data.description);
                setHasEdited(false);
            } else {
                console.error('Failed to generate description:', data?.error);
                setDescription(createBestGuessDescription(product, fields));
                setHasEdited(false);
            }
        } catch (error) {
            console.error('Error generating description:', error);
            setDescription(createBestGuessDescription(product, fields));
            setHasEdited(false);
        } finally {
            setIsGenerating(false);
        }
    }, [product, fields]);

    // Handle manual edit of description
    const handleDescriptionEdit = useCallback((newValue) => {
        if (!hasEdited && description && newValue !== description) {
            setShowEditWarning(true);
        }
        setDescription(newValue);
        setHasEdited(true);
    }, [hasEdited, description]);

    // Handle regenerate See It Now prompt
    const handleRegeneratePrompt = useCallback(async () => {
        setIsRegenerating(true);
        try {
            const numericId = product?.id ? String(product.id).split('/').pop() : null;
            if (!numericId || !asset?.id) {
                console.error('Missing product ID or asset ID');
                return;
            }

            const response = await fetch('/api/products/regenerate-prompt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    productId: numericId,
                    assetId: asset.id
                }),
            });

            const data = await response.json();
            if (data.success) {
                setGeneratedSeeItNowPrompt(data.prompt || '');
                setSeeItNowVariants(data.variants || []);
                setDetectedArchetype(data.archetype || null);
                // Regenerate endpoint persists to DB, so treat as clean state.
                setGeneratedPromptDirty(false);
                setVariantsDirty(false);
            } else {
                console.error('Failed to regenerate prompt:', data.error);
            }
        } catch (error) {
            console.error('Error regenerating prompt:', error);
        } finally {
            setIsRegenerating(false);
        }
    }, [product?.id, asset?.id]);

    // Handle reset variants to defaults
    const handleResetVariants = useCallback(() => {
        if (!detectedArchetype) return;
        const defaults = buildDefaultSeeItNowVariants(detectedArchetype);
        if (defaults.length === 0) return;
        setSeeItNowVariants(defaults);
        setVariantsDirty(true);
    }, [detectedArchetype]);
    
    // Options for dropdowns
    const surfaces = ['floor', 'wall', 'table', 'ceiling', 'shelf', 'other'];
    const orientations = ['upright', 'flat', 'leaning', 'wall-mounted', 'hanging', 'draped', 'other'];
    const materials = ['fabric', 'wood', 'metal', 'glass', 'ceramic', 'stone', 'leather', 'mixed', 'other'];
    const shadows = ['contact', 'cast', 'soft', 'none'];
    
    // Placement rule options
    const sceneRoles = ['Dominant', 'Integrated'];
    const replacementRules = ['Same Role Only', 'Similar Size or Position', 'Any Blocking Object', 'None'];

    return (
        <div className="space-y-8 fade-in">
            
            {/* SECTION 1: Structured Fields */}
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-neutral-900">Product Properties</h3>
                    <span className="text-xs text-neutral-500 bg-neutral-100 px-2 py-1 rounded-full">
                        Auto-detected • Review & adjust
                    </span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Surface */}
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-neutral-700">
                            Typical Placement
                        </label>
                        <p className="text-xs text-neutral-500">Where does this product usually go?</p>
                        <div className="flex flex-wrap gap-2 mt-2">
                            {surfaces.map(s => (
                                <button
                                    key={s}
                                    onClick={() => updateField('surface', s)}
                                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                                        fields.surface === s
                                            ? 'bg-neutral-900 text-white'
                                            : 'bg-white border border-neutral-200 text-neutral-600 hover:border-neutral-400'
                                    }`}
                                >
                                    {s.charAt(0).toUpperCase() + s.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>
                    
                    {/* Material */}
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-neutral-700">
                            Primary Material
                        </label>
                        <p className="text-xs text-neutral-500">Main material for lighting/reflections</p>
                        <div className="flex flex-wrap gap-2 mt-2">
                            {materials.map(m => (
                                <button
                                    key={m}
                                    onClick={() => updateField('material', m)}
                                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                                        fields.material === m
                                            ? 'bg-neutral-900 text-white'
                                            : 'bg-white border border-neutral-200 text-neutral-600 hover:border-neutral-400'
                                    }`}
                                >
                                    {m.charAt(0).toUpperCase() + m.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>
                    
                    {/* Orientation */}
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-neutral-700">
                            Typical Orientation
                        </label>
                        <p className="text-xs text-neutral-500">How is it usually positioned?</p>
                        <div className="flex flex-wrap gap-2 mt-2">
                            {orientations.map(o => (
                                <button
                                    key={o}
                                    onClick={() => updateField('orientation', o)}
                                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                                        fields.orientation === o
                                            ? 'bg-neutral-900 text-white'
                                            : 'bg-white border border-neutral-200 text-neutral-600 hover:border-neutral-400'
                                    }`}
                                >
                                    {o.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                                </button>
                            ))}
                        </div>
                    </div>
                    
                    {/* Shadow */}
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-neutral-700">
                            Shadow Type
                        </label>
                        <p className="text-xs text-neutral-500">How should shadows render?</p>
                        <div className="flex flex-wrap gap-2 mt-2">
                            {shadows.map(s => (
                                <button
                                    key={s}
                                    onClick={() => updateField('shadow', s)}
                                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                                        fields.shadow === s
                                            ? 'bg-neutral-900 text-white'
                                            : 'bg-white border border-neutral-200 text-neutral-600 hover:border-neutral-400'
                                    }`}
                                >
                                    {s.charAt(0).toUpperCase() + s.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
                
                {/* Dimensions */}
                <div className="space-y-2">
                    <label className="block text-sm font-semibold text-neutral-700">
                        Product dimensions (cm) <span className="font-normal text-neutral-400">(optional)</span>
                    </label>
                    <p className="text-xs text-neutral-500">
                        Used to help the AI keep proportions consistent. This is for merchant setup only (not shown to customers).
                    </p>
                    <div className="grid grid-cols-2 gap-4 max-w-xs">
                        <div className="relative">
                            <input
                                type="number"
                                step="any"
                                placeholder="Height"
                                value={fields.dimensions?.height || ''}
                                onChange={(e) => updateField('dimensions.height', e.target.value ? parseFloat(e.target.value) : null)}
                                className="w-full pl-3 pr-10 py-2 bg-white border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400">cm</span>
                        </div>
                        <div className="relative">
                            <input
                                type="number"
                                step="any"
                                placeholder="Width"
                                value={fields.dimensions?.width || ''}
                                onChange={(e) => updateField('dimensions.width', e.target.value ? parseFloat(e.target.value) : null)}
                                className="w-full pl-3 pr-10 py-2 bg-white border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400">cm</span>
                        </div>
                    </div>
                </div>
                
                {/* Additional Notes */}
                <div className="space-y-2">
                    <label className="block text-sm font-semibold text-neutral-700">
                        Special Notes <span className="font-normal text-neutral-400">(anything the AI should know)</span>
                    </label>
                    <textarea
                        placeholder="e.g., 'Brass frame has aged patina', 'Glass shelves are transparent', 'Fabric has subtle sheen'"
                        value={fields.additionalNotes || ''}
                        onChange={(e) => updateField('additionalNotes', e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-neutral-200 rounded-lg text-sm min-h-[80px] resize-none focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
                        maxLength={200}
                    />
                    <p className="text-xs text-neutral-400 text-right">{(fields.additionalNotes || '').length}/200</p>
                </div>
            </div>
            
            {/* Divider */}
            <div className="border-t border-neutral-200"></div>
            
            {/* SECTION: Placement Rules */}
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-neutral-900">Placement Rules</h3>
                    <span className="text-xs text-neutral-500 bg-neutral-100 px-2 py-1 rounded-full">
                        Auto-detected • Review & adjust
                    </span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Scene Role */}
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-neutral-700">
                            Scene Role
                        </label>
                        <p className="text-xs text-neutral-500">How does this product fit in the room?</p>
                        <div className="flex flex-wrap gap-2 mt-2">
                            {sceneRoles.map(role => (
                                <button
                                    key={role}
                                    onClick={() => setPlacementRulesFields(prev => ({ ...prev, sceneRole: role }))}
                                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                                        placementRulesFields.sceneRole === role
                                            ? 'bg-neutral-900 text-white'
                                            : 'bg-white border border-neutral-200 text-neutral-600 hover:border-neutral-400'
                                    }`}
                                >
                                    {role}
                                </button>
                            ))}
                        </div>
                    </div>
                    
                    {/* Replacement Rule */}
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-neutral-700">
                            Replacement Rule
                        </label>
                        <p className="text-xs text-neutral-500">What can be replaced when placing this product?</p>
                        <div className="flex flex-col gap-2 mt-2">
                            {replacementRules.map(rule => (
                                <button
                                    key={rule}
                                    onClick={() => setPlacementRulesFields(prev => ({ ...prev, replacementRule: rule }))}
                                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all text-left ${
                                        placementRulesFields.replacementRule === rule
                                            ? 'bg-neutral-900 text-white'
                                            : 'bg-white border border-neutral-200 text-neutral-600 hover:border-neutral-400'
                                    }`}
                                >
                                    {rule}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
                
                {/* Allow Space Creation */}
                <div className="space-y-2">
                    <label className="flex items-center gap-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={placementRulesFields.allowSpaceCreation === true}
                            onChange={(e) => setPlacementRulesFields(prev => ({ ...prev, allowSpaceCreation: e.target.checked }))}
                            className="w-4 h-4 text-neutral-900 border-neutral-300 rounded focus:ring-neutral-900/10"
                        />
                        <div>
                            <span className="block text-sm font-semibold text-neutral-700">Allow Space Creation</span>
                            <span className="block text-xs text-neutral-500">Allow minimal space creation if product doesn't fit</span>
                        </div>
                    </label>
                </div>
            </div>
            
            {/* Divider */}
            <div className="border-t border-neutral-200"></div>
            
            {/* SECTION 2: Placement Prompts (See It and See It Now) */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-neutral-900">Placement Prompts</h3>
                        <p className="text-sm text-neutral-500 mt-1">
                            Natural language prompts that help the AI place your product realistically in room photos.
                        </p>
                    </div>
                    <Button
                        variant="primary"
                        onClick={handleGenerate}
                        loading={isGenerating}
                        disabled={isGenerating}
                    >
                        {description ? 'Regenerate Prompt' : 'Generate Prompt'}
                    </Button>
                </div>
                
                {/* Two-column layout for prompts */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Left: See It Prompt */}
                    <div className="space-y-2">
                        <div>
                            <label className="block text-sm font-semibold text-neutral-700">
                                See It prompt
                            </label>
                            <p className="text-xs text-neutral-500 mt-0.5">
                                Used for full See It flow
                            </p>
                        </div>
                        <div className="relative">
                            {showEditWarning && (
                                <div className="absolute -top-2 left-0 right-0 bg-amber-50 border border-amber-200 rounded-lg p-3 z-10 shadow-lg">
                                    <div className="flex items-start gap-2">
                                        <svg className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                                        </svg>
                                        <div className="flex-1">
                                            <p className="text-sm font-semibold text-amber-800">Edit at your own risk</p>
                                            <p className="text-xs text-amber-700 mt-1">
                                                This description was optimised for AI rendering. Manual edits may reduce quality.
                                            </p>
                                        </div>
                                        <button 
                                            onClick={() => setShowEditWarning(false)}
                                            className="text-amber-600 hover:text-amber-800"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            )}
                            
                            <div className={`bg-neutral-900 rounded-xl p-4 ${showEditWarning ? 'mt-16' : ''}`}>
                                {description ? (
                                    <textarea
                                        value={description}
                                        onChange={(e) => handleDescriptionEdit(e.target.value)}
                                        className="w-full bg-transparent text-neutral-100 text-sm leading-relaxed resize-none focus:outline-none min-h-[120px]" 
                                        placeholder="Click 'Generate Prompt' to create a placement prompt..."
                                    />
                                ) : (
                                    <div className="text-neutral-400 text-sm py-8 text-center">
                                        <p>No placement prompt yet.</p>
                                        <p className="mt-1">Review the fields above, then click <strong>Generate Prompt</strong>.</p>
                                    </div>
                                )}
                            </div>
                            
                            {description && (
                                <div className="flex items-center justify-between mt-2 px-1">
                                    <span className="text-xs text-neutral-400">
                                        {description.length} characters
                                    </span>
                                    {hasEdited && (
                                        <span className="text-xs text-amber-600 flex items-center gap-1">
                                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                            </svg>
                                            Manually edited
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right: See It Now Prompt */}
                    <div className="space-y-2">
                        <div>
                            <label className="block text-sm font-semibold text-neutral-700">
                                See It Now prompt
                            </label>
                            <p className="text-xs text-neutral-500 mt-0.5">
                                Used for instant See It Now flow. Leave blank to use the See It prompt.
                            </p>
                        </div>
                        <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-4">
                            <textarea
                                value={seeItNowPrompt}
                                onChange={(e) => {
                                    setSeeItNowPrompt(e.target.value);
                                    setSeeItNowDirty(true);
                                }}
                                className="w-full bg-transparent text-neutral-900 text-sm leading-relaxed resize-none focus:outline-none min-h-[120px]" 
                                placeholder="Leave blank to use the See It prompt..."
                            />
                            {seeItNowPrompt && (
                                <div className="flex items-center justify-between mt-2 px-1">
                                    <span className="text-xs text-neutral-400">
                                        {seeItNowPrompt.length} characters
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Divider */}
            <div className="border-t border-neutral-200"></div>

            {/* SECTION 3: See It Now - Generated Prompt */}
            <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-bold text-neutral-900">See It Now - Generated Prompt</h3>
                            <p className="text-sm text-neutral-500 mt-1">
                                LLM-generated prompt with product-specific details and selected variations.
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={useGeneratedPrompt}
                                    onChange={(e) => setUseGeneratedPrompt(e.target.checked)}
                                    disabled={(!generatedSeeItNowPrompt || !generatedSeeItNowPrompt.trim()) && !useGeneratedPrompt}
                                    className="w-4 h-4 text-neutral-900 border-neutral-300 rounded focus:ring-neutral-900/10"
                                />
                                <span className="text-sm font-medium text-neutral-700">
                                    Use Generated Prompt
                                </span>
                            </label>
                        </div>
                    </div>

                    {!generatedSeeItNowPrompt?.trim() && (
                        <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3 text-sm text-neutral-600">
                            No per-product prompt yet. Click <strong>Regenerate</strong> to create one (or paste/edit your own).
                        </div>
                    )}

                    {/* Archetype Badge */}
                    {detectedArchetype && (
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-neutral-500">Detected Archetype:</span>
                            <span className="px-2 py-1 bg-neutral-100 text-neutral-700 text-xs font-medium rounded-full">
                                {detectedArchetype.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                            </span>
                        </div>
                    )}

                    {/* Generated Prompt Textarea */}
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-neutral-700">
                            Product Prompt
                        </label>
                        <textarea
                            value={generatedSeeItNowPrompt}
                            onChange={(e) => {
                                setGeneratedSeeItNowPrompt(e.target.value);
                                setGeneratedPromptDirty(true);
                            }}
                            className="w-full px-3 py-2 bg-white border border-neutral-200 rounded-lg text-sm min-h-[200px] resize-none focus:outline-none focus:ring-2 focus:ring-neutral-900/10 font-mono text-xs"
                            placeholder="Generated prompt will appear here..."
                        />
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-neutral-400">
                                {generatedSeeItNowPrompt.length} characters
                            </span>
                            {generatedPromptDirty && (
                                <span className="text-xs text-amber-600 flex items-center gap-1">
                                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                    </svg>
                                    Edited
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Variants List */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="block text-sm font-semibold text-neutral-700">
                                Variants ({seeItNowVariants.length})
                            </label>
                            <div className="flex gap-2">
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={handleResetVariants}
                                    disabled={!detectedArchetype || isRegenerating}
                                >
                                    Reset to Defaults
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={handleRegeneratePrompt}
                                    loading={isRegenerating}
                                    disabled={isRegenerating || !asset?.id}
                                >
                                    Regenerate
                                </Button>
                            </div>
                        </div>
                        <div className="space-y-2">
                            {seeItNowVariants.map((variant, index) => (
                                <div key={variant.id || index} className="relative group">
                                    <div className="flex items-start gap-2">
                                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-neutral-100 text-neutral-500 text-xs flex items-center justify-center mt-2">
                                            {index + 1}
                                        </span>
                                        <div className="flex-1">
                                            <input
                                                type="text"
                                                value={variant.prompt || ''}
                                                onChange={(e) => {
                                                    const newVariants = [...seeItNowVariants];
                                                    newVariants[index] = { ...variant, prompt: e.target.value };
                                                    setSeeItNowVariants(newVariants);
                                                    setVariantsDirty(true);
                                                }}
                                                className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
                                                placeholder="Enter variant prompt..."
                                            />
                                            <span className="text-xs text-neutral-400 mt-1 block">{variant.id}</span>
                                        </div>
                                        {seeItNowVariants.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const newVariants = seeItNowVariants.filter((_, i) => i !== index);
                                                    setSeeItNowVariants(newVariants);
                                                    setVariantsDirty(true);
                                                }}
                                                className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-2 text-neutral-400 hover:text-red-500"
                                                title="Remove variant"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                const newId = `custom_${Date.now()}`;
                                setSeeItNowVariants([...seeItNowVariants, { id: newId, prompt: '' }]);
                                setVariantsDirty(true);
                            }}
                            className="text-xs px-2 py-1 bg-neutral-100 hover:bg-neutral-200 rounded-md text-neutral-700 transition-colors"
                        >
                            + Add Variant
                        </button>
                    </div>
                </div>
            
            {/* Status Message */}
            {description && !hasEdited && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-3">
                    <svg className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                    <div>
                        <p className="text-sm font-semibold text-emerald-800">Ready to save</p>
                        <p className="text-xs text-emerald-700 mt-1">
                            This placement prompt will be used for all AR renders of this product.
                        </p>
                    </div>
                </div>
            )}

            {/* Enable Toggle Section */}
            <div className="mt-8 pt-6 border-t border-neutral-200">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-semibold text-neutral-900">
                            Enable for customers
                        </h3>
                        <p className="text-xs text-neutral-500 mt-0.5">
                            Show "See It In Your Space" button on your store
                        </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(e) => setEnabled(e.target.checked)}
                            disabled={asset?.status !== 'ready' && asset?.status !== 'live'}
                            className="sr-only peer"
                        />
                        <div className={`
                            w-11 h-6 rounded-full peer
                            peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-500/20
                            after:content-[''] after:absolute after:top-[2px] after:left-[2px]
                            after:bg-white after:border-neutral-300 after:border after:rounded-full
                            after:h-5 after:w-5 after:transition-all
                            peer-checked:after:translate-x-full peer-checked:after:border-white
                            ${enabled
                                ? 'bg-emerald-500'
                                : 'bg-neutral-200'
                            }
                            ${(asset?.status !== 'ready' && asset?.status !== 'live')
                                ? 'opacity-50 cursor-not-allowed'
                                : ''
                            }
                        `}></div>
                    </label>
                </div>

                {/* Status indicator */}
                <div className="mt-3">
                    {asset?.status === 'preparing' || asset?.status === 'pending' || asset?.status === 'processing' ? (
                        <div className="flex items-center gap-2 text-sm text-amber-600">
                            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                            Product is being prepared...
                        </div>
                    ) : asset?.status === 'failed' ? (
                        <div className="flex items-center gap-2 text-sm text-red-600">
                            <span className="w-2 h-2 rounded-full bg-red-500"></span>
                            Preparation failed. Please retry.
                        </div>
                    ) : !asset || asset?.status === 'unprepared' ? (
                        <div className="flex items-center gap-2 text-sm text-neutral-500">
                            <span className="w-2 h-2 rounded-full bg-neutral-300"></span>
                            Prepare the product first to enable
                        </div>
                    ) : enabled ? (
                        <div className="flex items-center gap-2 text-sm text-emerald-600">
                            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                            Customers can see this product in their space
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 text-sm text-neutral-500">
                            <span className="w-2 h-2 rounded-full bg-neutral-300"></span>
                            Enable to show on your store
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
