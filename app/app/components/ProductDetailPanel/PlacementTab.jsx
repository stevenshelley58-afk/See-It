import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useFetcher } from '@remix-run/react';
import { Button, Card } from '../ui';
import { buildPlacementTabMetadata } from './placementTabMetadata';


/**
 * PlacementTab - Product preparation for rendering (Canonical Pipeline)
 *
 * Canonical Fields (from ProductAsset):
 * - extractedFacts: LLM #1 output (read-only)
 * - merchantOverrides: Merchant edits (sparse diff, editable)
 * - resolvedFacts: merged(extracted, overrides) (read-only)
 * - placementSet: LLM #2 output with variants (read-only)
 *
 * Flow:
 * 1. System extracts product facts via LLM
 * 2. Merchant reviews extracted facts and can override specific fields
 * 3. Save → merchantOverrides saved, triggers regeneration of resolvedFacts + placementSet
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
    // - "H: 180cm W: 95cm"
    // - "Height 180 Width 95"
    //
    // NOTE: Be conservative with unlabeled "A × B" patterns.
    // Many Shopify PDPs use "25×25cm" to mean footprint (W×D), not height×width.
    const hasExplicitAxes =
        /\b(h(?:eight)?)\b/i.test(text) ||
        /\b(w(?:idth)?)\b/i.test(text) ||
        /\bH\s*[x×]\s*W\b/i.test(text) ||
        /\bW\s*[x×]\s*H\b/i.test(text) ||
        /\bHxW\b/i.test(text) ||
        /\bWxH\b/i.test(text);

    if (hasExplicitAxes) {
        const cross = text.match(/(\d{2,4}(?:\.\d+)?)\s*(?:cm|mm|")?\s*[x×]\s*(\d{2,4}(?:\.\d+)?)\s*(?:cm|mm|")?/i);
        if (cross) {
            return { height: parseFloat(cross[1]), width: parseFloat(cross[2]) };
        }
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

function formatVariantLabel(id) {
    return (id || '')
        .toString()
        .split('-')
        .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
        .join(' ');
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getPath(obj, path) {
    let cur = obj;
    for (const key of path) {
        if (!isPlainObject(cur)) return undefined;
        cur = cur[key];
    }
    return cur;
}

function setPath(obj, path, value) {
    const next = isPlainObject(obj) ? { ...obj } : {};
    let cur = next;
    for (let i = 0; i < path.length; i++) {
        const key = path[i];
        if (i === path.length - 1) {
            cur[key] = value;
        } else {
            const existing = cur[key];
            cur[key] = isPlainObject(existing) ? { ...existing } : {};
            cur = cur[key];
        }
    }
    return next;
}

function deletePath(obj, path) {
    if (!isPlainObject(obj)) return {};
    const next = { ...obj };
    const stack = [];
    let cur = next;
    for (let i = 0; i < path.length; i++) {
        const key = path[i];
        if (!isPlainObject(cur)) return next;
        stack.push({ parent: cur, key });
        if (i === path.length - 1) {
            delete cur[key];
        } else {
            const child = cur[key];
            cur[key] = isPlainObject(child) ? { ...child } : {};
            cur = cur[key];
        }
    }
    // Clean up empty objects bottom-up
    for (let i = stack.length - 1; i >= 0; i--) {
        const { parent, key } = stack[i];
        const val = parent[key];
        if (isPlainObject(val) && Object.keys(val).length === 0) {
            delete parent[key];
        }
    }
    return next;
}

function stableStringify(value) {
    if (!isPlainObject(value) && !Array.isArray(value)) return JSON.stringify(value);
    const sort = (v) => {
        if (Array.isArray(v)) return v.map(sort);
        if (!isPlainObject(v)) return v;
        const out = {};
        for (const k of Object.keys(v).sort()) {
            out[k] = sort(v[k]);
        }
        return out;
    };
    return JSON.stringify(sort(value));
}

// ============================================================================
// COMPONENT
// ============================================================================

export function PlacementTab({ product, asset, onChange }) {
    const fetcher = useFetcher();

    // Legacy renderInstructions field has been removed from schema
    // Descriptions are now generated from placementSet when needed
    const existingDescription = null;

    // Auto-detect initial fields (fallback if no saved data)
    const detectedFields = useMemo(() => autoDetectFields(product), [product]);

    // Initialize fields from extractedFacts/resolvedFacts (canonical) or auto-detect
    const initialFields = useMemo(() => {
        // Try to get values from resolvedFacts (canonical pipeline)
        const resolved = isPlainObject(asset?.resolvedFacts) ? asset.resolvedFacts : null;
        const extracted = isPlainObject(asset?.extractedFacts) ? asset.extractedFacts : null;
        const facts = resolved || extracted;

        if (facts) {
            // Map canonical facts to UI fields where possible
            return {
                surface: detectedFields.surface, // not in canonical schema, use auto-detect
                material: facts?.material_profile?.primary || detectedFields.material,
                orientation: detectedFields.orientation, // not in canonical schema
                shadow: detectedFields.surface === 'ceiling' ? 'none' : 'contact',
                dimensions: facts?.typical_dimensions_cm || detectedFields.dimensions || { height: null, width: null },
                additionalNotes: '',
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
    }, [asset?.resolvedFacts, asset?.extractedFacts, detectedFields]);

    // State
    const [fields, setFields] = useState(initialFields);

    // Update state when canonical facts change (e.g., asset loads async)
    useEffect(() => {
        const resolved = isPlainObject(asset?.resolvedFacts) ? asset.resolvedFacts : null;
        const extracted = isPlainObject(asset?.extractedFacts) ? asset.extractedFacts : null;
        const facts = resolved || extracted;
        if (facts) {
            setFields(prev => ({
                surface: prev.surface, // keep user selection
                material: facts?.material_profile?.primary || prev.material,
                orientation: prev.orientation,
                shadow: prev.shadow,
                dimensions: facts?.typical_dimensions_cm || prev.dimensions || { height: null, width: null },
                additionalNotes: prev.additionalNotes,
            }));
        }
    }, [asset?.resolvedFacts, asset?.extractedFacts]);

    // placement rules state - use auto-detected defaults (legacy columns removed from schema)
    // These are now UI-only fields for the Generate Prompt feature
    const [placementRulesFields, setPlacementRulesFields] = useState({
        sceneRole: detectedFields.sceneRole || null,
        replacementRule: detectedFields.replacementRule || null,
        allowSpaceCreation: detectedFields.allowSpaceCreation,
    });

    const [description, setDescription] = useState(existingDescription || '');
    const [isGenerating, setIsGenerating] = useState(false);
    const [hasEdited, setHasEdited] = useState(false);
    const [showEditWarning, setShowEditWarning] = useState(false);

    // See It Now prompt state (legacy renderInstructionsSeeItNow removed)
    // Prompts are now generated from placementSet via the canonical pipeline
    const [seeItNowPrompt, setSeeItNowPrompt] = useState('');
    const [seeItNowDirty, setSeeItNowDirty] = useState(false);



    // See It Now v2 merchant overrides (sparse diff)
    const initialMerchantOverridesKey = asset?.id || asset?.productId || 'unknown';
    const initialMerchantOverrides = useMemo(() => {
        if (isPlainObject(asset?.merchantOverrides)) return asset.merchantOverrides;
        return {};
    }, [asset?.merchantOverrides]);

    const [merchantOverrides, setMerchantOverrides] = useState(initialMerchantOverrides);
    const [merchantOverridesDirty, setMerchantOverridesDirty] = useState(false);

    // Sync overrides when asset loads async (only if not dirty)
    useEffect(() => {
        if (merchantOverridesDirty) return;
        setMerchantOverrides(initialMerchantOverrides);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialMerchantOverridesKey]);

    // Compute dirty (compare to initial snapshot)
    useEffect(() => {
        const dirty =
            stableStringify(merchantOverrides || {}) !==
            stableStringify(initialMerchantOverrides || {});
        setMerchantOverridesDirty(dirty);
    }, [merchantOverrides, initialMerchantOverrides]);

    const extractedFacts = useMemo(() => (isPlainObject(asset?.extractedFacts) ? asset.extractedFacts : null), [asset?.extractedFacts]);
    const resolvedFacts = useMemo(() => (isPlainObject(asset?.resolvedFacts) ? asset.resolvedFacts : null), [asset?.resolvedFacts]);

    const materialPrimaryValue =
        getPath(merchantOverrides, ["material_profile", "primary"]) ??
        getPath(resolvedFacts, ["material_profile", "primary"]) ??
        getPath(extractedFacts, ["material_profile", "primary"]) ??
        "unknown";
    const materialPrimaryIsOverridden = getPath(merchantOverrides, ["material_profile", "primary"]) !== undefined;

    const relativeScaleClassValue =
        getPath(merchantOverrides, ["relative_scale", "class"]) ??
        getPath(resolvedFacts, ["relative_scale", "class"]) ??
        getPath(extractedFacts, ["relative_scale", "class"]) ??
        "unknown";
    const relativeScaleClassIsOverridden = getPath(merchantOverrides, ["relative_scale", "class"]) !== undefined;

    const croppingPolicyValue =
        getPath(merchantOverrides, ["render_behavior", "cropping_policy"]) ??
        getPath(resolvedFacts, ["render_behavior", "cropping_policy"]) ??
        getPath(extractedFacts, ["render_behavior", "cropping_policy"]) ??
        "allow_small_crop";
    const croppingPolicyIsOverridden = getPath(merchantOverrides, ["render_behavior", "cropping_policy"]) !== undefined;



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

    // Legacy renderInstructionsSeeItNow hydration removed - prompts come from placementSet now

    // Notify parent when description, placementFields, placement rules, See It Now prompt, or enabled change
    useEffect(() => {
        if (onChange) {
            // Pass renderInstructions (placement prompt), placementFields, placement rules config, See It Now prompt, and enabled
            onChange(buildPlacementTabMetadata({
                description,
                seeItNowPrompt,
                seeItNowDirty,
                fields,
                placementRulesFields,
                merchantOverrides,
                merchantOverridesDirty,
                hasEdited,
                enabled,
                originalEnabled: asset?.enabled || false,
            }));
        }
    }, [description, seeItNowPrompt, seeItNowDirty, fields, placementRulesFields, enabled, asset?.enabled, merchantOverrides, merchantOverridesDirty, hasEdited, onChange]);

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



    // Options for dropdowns
    const surfaces = ['floor', 'wall', 'table', 'ceiling', 'shelf', 'other'];
    const orientations = ['upright', 'flat', 'leaning', 'wall-mounted', 'hanging', 'draped', 'other'];
    const materials = ['fabric', 'wood', 'metal', 'glass', 'ceramic', 'stone', 'leather', 'mixed', 'other'];
    const shadows = ['contact', 'cast', 'soft', 'none'];

    // Placement rule options
    const sceneRoles = ['Dominant', 'Integrated'];
    const replacementRules = ['Same Role Only', 'Similar Size or Position', 'Any Blocking Object', 'None'];

    // See It Now v2 override options (must match `product-facts.schema.ts`)
    const materialPrimaryOptions = [
        "reclaimed_teak",
        "painted_wood",
        "glass",
        "mirror",
        "ceramic",
        "metal",
        "stone",
        "fabric",
        "leather",
        "mixed",
        "unknown",
    ];
    const relativeScaleClassOptions = [
        "tiny",
        "small",
        "medium",
        "large",
        "oversized",
        "architectural",
        "unknown",
    ];
    const croppingPolicyOptions = [
        "never_crop_product",
        "allow_small_crop",
        "allow_crop_if_needed",
    ];

    return (
        // Give the Placement tab a subtle surface so Cards visually stand out inside the Polaris modal.
        <div className="space-y-6 fade-in -mx-6 px-6 py-6 bg-[#FAFAFA]" data-ui-rev="placement-2026-01-25-616a921">
            {/* Debug marker: proves the iframe is loading the latest bundle. Remove after verification. */}
            <div className="text-[11px] text-[#737373]">
                Placement UI rev: <span className="font-mono">placement-2026-01-25-616a921</span>
            </div>

            {/* SECTION 1: Structured Fields */}
            <Card className="space-y-6">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-[#1A1A1A]">Product Properties</h3>
                    <span className="text-xs text-[#737373] bg-[#F0F0F0] px-2 py-1 rounded-full">
                        Auto-detected • Review & adjust
                    </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Surface */}
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-[#1A1A1A]">
                            Typical Placement
                        </label>
                        <p className="text-xs text-[#737373]">Where does this product usually go?</p>
                        <div className="flex flex-wrap gap-2 mt-2">
                            {surfaces.map(s => (
                                <button
                                    key={s}
                                    onClick={() => updateField('surface', s)}
                                    className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-all ${fields.surface === s
                                        ? 'bg-[#171717] text-white shadow-sm'
                                        : 'bg-white border border-[#E5E5E5] text-[#737373] hover:border-[#A3A3A3] hover:bg-[#FAFAFA]'
                                        }`}
                                >
                                    {s.charAt(0).toUpperCase() + s.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Material */}
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-[#1A1A1A]">
                            Primary Material
                        </label>
                        <p className="text-xs text-[#737373]">Main material for lighting/reflections</p>
                        <div className="flex flex-wrap gap-2 mt-2">
                            {materials.map(m => (
                                <button
                                    key={m}
                                    onClick={() => updateField('material', m)}
                                    className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-all ${fields.material === m
                                        ? 'bg-[#171717] text-white shadow-sm'
                                        : 'bg-white border border-[#E5E5E5] text-[#737373] hover:border-[#A3A3A3] hover:bg-[#FAFAFA]'
                                        }`}
                                >
                                    {m.charAt(0).toUpperCase() + m.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Orientation */}
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-[#1A1A1A]">
                            Typical Orientation
                        </label>
                        <p className="text-xs text-[#737373]">How is it usually positioned?</p>
                        <div className="flex flex-wrap gap-2 mt-2">
                            {orientations.map(o => (
                                <button
                                    key={o}
                                    onClick={() => updateField('orientation', o)}
                                    className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-all ${fields.orientation === o
                                        ? 'bg-[#171717] text-white shadow-sm'
                                        : 'bg-white border border-[#E5E5E5] text-[#737373] hover:border-[#A3A3A3] hover:bg-[#FAFAFA]'
                                        }`}
                                >
                                    {o.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Shadow */}
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-[#1A1A1A]">
                            Shadow Type
                        </label>
                        <p className="text-xs text-[#737373]">How should shadows render?</p>
                        <div className="flex flex-wrap gap-2 mt-2">
                            {shadows.map(s => (
                                <button
                                    key={s}
                                    onClick={() => updateField('shadow', s)}
                                    className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-all ${fields.shadow === s
                                        ? 'bg-[#171717] text-white shadow-sm'
                                        : 'bg-white border border-[#E5E5E5] text-[#737373] hover:border-[#A3A3A3] hover:bg-[#FAFAFA]'
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
                    <label className="block text-sm font-semibold text-[#1A1A1A]">
                        Product dimensions (cm) <span className="font-normal text-[#A3A3A3]">(optional)</span>
                    </label>
                    <p className="text-xs text-[#737373]">
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
                                className="w-full pl-3 pr-10 py-2 bg-white border border-[#E5E5E5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#171717]/10 focus:border-[#171717]"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#A3A3A3]">cm</span>
                        </div>
                        <div className="relative">
                            <input
                                type="number"
                                step="any"
                                placeholder="Width"
                                value={fields.dimensions?.width || ''}
                                onChange={(e) => updateField('dimensions.width', e.target.value ? parseFloat(e.target.value) : null)}
                                className="w-full pl-3 pr-10 py-2 bg-white border border-[#E5E5E5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#171717]/10 focus:border-[#171717]"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#A3A3A3]">cm</span>
                        </div>
                    </div>
                </div>

                {/* Additional Notes */}
                <div className="space-y-2">
                    <label className="block text-sm font-semibold text-[#1A1A1A]">
                        Special Notes <span className="font-normal text-[#A3A3A3]">(anything the AI should know)</span>
                    </label>
                    <textarea
                        placeholder="e.g., 'Brass frame has aged patina', 'Glass shelves are transparent', 'Fabric has subtle sheen'"
                        value={fields.additionalNotes || ''}
                        onChange={(e) => updateField('additionalNotes', e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-[#E5E5E5] rounded-xl text-sm min-h-[80px] resize-none focus:outline-none focus:ring-2 focus:ring-[#171717]/10 focus:border-[#171717]"
                        maxLength={200}
                    />
                    <p className="text-xs text-[#A3A3A3] text-right">{(fields.additionalNotes || '').length}/200</p>
                </div>
            </Card>

            {/* SECTION: Placement Rules */}
            <Card className="space-y-6">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-[#1A1A1A]">Placement Rules</h3>
                    <span className="text-xs text-[#737373] bg-[#F0F0F0] px-2 py-1 rounded-full">
                        Auto-detected • Review & adjust
                    </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Scene Role */}
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-[#1A1A1A]">
                            Scene Role
                        </label>
                        <p className="text-xs text-[#737373]">How does this product fit in the room?</p>
                        <div className="flex flex-wrap gap-2 mt-2">
                            {sceneRoles.map(role => (
                                <button
                                    key={role}
                                    onClick={() => setPlacementRulesFields(prev => ({ ...prev, sceneRole: role }))}
                                    className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-all ${placementRulesFields.sceneRole === role
                                        ? 'bg-[#171717] text-white shadow-sm'
                                        : 'bg-white border border-[#E5E5E5] text-[#737373] hover:border-[#A3A3A3] hover:bg-[#FAFAFA]'
                                        }`}
                                >
                                    {role}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Replacement Rule */}
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-[#1A1A1A]">
                            Replacement Rule
                        </label>
                        <p className="text-xs text-[#737373]">What can be replaced when placing this product?</p>
                        <div className="flex flex-col gap-2 mt-2">
                            {replacementRules.map(rule => (
                                <button
                                    key={rule}
                                    onClick={() => setPlacementRulesFields(prev => ({ ...prev, replacementRule: rule }))}
                                    className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-all text-left ${placementRulesFields.replacementRule === rule
                                        ? 'bg-[#171717] text-white shadow-sm'
                                        : 'bg-white border border-[#E5E5E5] text-[#737373] hover:border-[#A3A3A3] hover:bg-[#FAFAFA]'
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
                            className="w-4 h-4 text-[#171717] border-[#E5E5E5] rounded focus:ring-[#171717]/10"
                        />
                        <div>
                            <span className="block text-sm font-semibold text-[#1A1A1A]">Allow Space Creation</span>
                            <span className="block text-xs text-[#737373]">Allow minimal space creation if product doesn't fit</span>
                        </div>
                    </label>
                </div>
            </Card>

            {/* SECTION: See It Now Facts / Overrides */}
            <Card className="space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-[#1A1A1A]">See It Now Facts / Overrides</h3>
                        <p className="text-sm text-[#737373] mt-1">
                            Optional merchant overrides for the v2 pipeline. These regenerate and save a new prompt pack when you click Save.
                        </p>
                    </div>
                    <span className="text-xs text-[#737373] bg-[#F0F0F0] px-2 py-1 rounded-full">
                        {extractedFacts ? 'Facts extracted' : 'Facts not extracted yet'}
                    </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Material primary */}
                    <div className="border border-[#E5E5E5] rounded-xl p-4 bg-white">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-sm font-semibold text-[#1A1A1A]">Primary material</div>
                                <div className="text-xs text-[#737373] mt-0.5">Affects reflections and material rules</div>
                            </div>
                            <label className="flex items-center gap-2 text-xs text-[#737373] select-none">
                                <input
                                    type="checkbox"
                                    checked={materialPrimaryIsOverridden}
                                    onChange={(e) => {
                                        const checked = e.target.checked;
                                        setMerchantOverrides((prev) => {
                                            const base = prev || {};
                                            if (!checked) return deletePath(base, ["material_profile", "primary"]);
                                            return setPath(base, ["material_profile", "primary"], materialPrimaryValue || "unknown");
                                        });
                                    }}
                                    className="w-4 h-4 text-[#171717] border-[#E5E5E5] rounded focus:ring-[#171717]/10"
                                />
                                Override
                            </label>
                        </div>
                        <select
                            value={materialPrimaryValue}
                            onChange={(e) => {
                                const v = e.target.value;
                                setMerchantOverrides((prev) => setPath(prev || {}, ["material_profile", "primary"], v));
                            }}
                            disabled={!materialPrimaryIsOverridden}
                            className={`mt-3 w-full text-sm border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#171717]/10 ${materialPrimaryIsOverridden
                                ? 'border-[#E5E5E5] bg-white text-[#1A1A1A]'
                                : 'border-[#F0F0F0] bg-[#FAFAFA] text-[#737373]'
                                }`}
                        >
                            {materialPrimaryOptions.map((opt) => (
                                <option key={opt} value={opt}>
                                    {opt}
                                </option>
                            ))}
                        </select>
                        {!materialPrimaryIsOverridden && (
                            <div className="mt-2 text-xs text-[#A3A3A3]">
                                Using extracted/resolved value: <span className="font-mono">{materialPrimaryValue}</span>
                            </div>
                        )}
                    </div>

                    {/* Relative scale class */}
                    <div className="border border-[#E5E5E5] rounded-xl p-4 bg-white">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-sm font-semibold text-[#1A1A1A]">Relative scale</div>
                                <div className="text-xs text-[#737373] mt-0.5">Helps size the product in room context</div>
                            </div>
                            <label className="flex items-center gap-2 text-xs text-[#737373] select-none">
                                <input
                                    type="checkbox"
                                    checked={relativeScaleClassIsOverridden}
                                    onChange={(e) => {
                                        const checked = e.target.checked;
                                        setMerchantOverrides((prev) => {
                                            const base = prev || {};
                                            if (!checked) return deletePath(base, ["relative_scale", "class"]);
                                            return setPath(base, ["relative_scale", "class"], relativeScaleClassValue || "unknown");
                                        });
                                    }}
                                    className="w-4 h-4 text-[#171717] border-[#E5E5E5] rounded focus:ring-[#171717]/10"
                                />
                                Override
                            </label>
                        </div>
                        <select
                            value={relativeScaleClassValue}
                            onChange={(e) => {
                                const v = e.target.value;
                                setMerchantOverrides((prev) => setPath(prev || {}, ["relative_scale", "class"], v));
                            }}
                            disabled={!relativeScaleClassIsOverridden}
                            className={`mt-3 w-full text-sm border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#171717]/10 ${relativeScaleClassIsOverridden
                                ? 'border-[#E5E5E5] bg-white text-[#1A1A1A]'
                                : 'border-[#F0F0F0] bg-[#FAFAFA] text-[#737373]'
                                }`}
                        >
                            {relativeScaleClassOptions.map((opt) => (
                                <option key={opt} value={opt}>
                                    {opt}
                                </option>
                            ))}
                        </select>
                        {!relativeScaleClassIsOverridden && (
                            <div className="mt-2 text-xs text-[#A3A3A3]">
                                Using extracted/resolved value: <span className="font-mono">{relativeScaleClassValue}</span>
                            </div>
                        )}
                    </div>

                    {/* Cropping policy */}
                    <div className="border border-[#E5E5E5] rounded-xl p-4 bg-white">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-sm font-semibold text-[#1A1A1A]">Cropping policy</div>
                                <div className="text-xs text-[#737373] mt-0.5">Controls whether the product may be cropped</div>
                            </div>
                            <label className="flex items-center gap-2 text-xs text-[#737373] select-none">
                                <input
                                    type="checkbox"
                                    checked={croppingPolicyIsOverridden}
                                    onChange={(e) => {
                                        const checked = e.target.checked;
                                        setMerchantOverrides((prev) => {
                                            const base = prev || {};
                                            if (!checked) return deletePath(base, ["render_behavior", "cropping_policy"]);
                                            return setPath(base, ["render_behavior", "cropping_policy"], croppingPolicyValue || "allow_small_crop");
                                        });
                                    }}
                                    className="w-4 h-4 text-[#171717] border-[#E5E5E5] rounded focus:ring-[#171717]/10"
                                />
                                Override
                            </label>
                        </div>
                        <select
                            value={croppingPolicyValue}
                            onChange={(e) => {
                                const v = e.target.value;
                                setMerchantOverrides((prev) => setPath(prev || {}, ["render_behavior", "cropping_policy"], v));
                            }}
                            disabled={!croppingPolicyIsOverridden}
                            className={`mt-3 w-full text-sm border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#171717]/10 ${croppingPolicyIsOverridden
                                ? 'border-[#E5E5E5] bg-white text-[#1A1A1A]'
                                : 'border-[#F0F0F0] bg-[#FAFAFA] text-[#737373]'
                                }`}
                        >
                            {croppingPolicyOptions.map((opt) => (
                                <option key={opt} value={opt}>
                                    {opt}
                                </option>
                            ))}
                        </select>
                        {!croppingPolicyIsOverridden && (
                            <div className="mt-2 text-xs text-[#A3A3A3]">
                                Using extracted/resolved value: <span className="font-mono">{croppingPolicyValue}</span>
                            </div>
                        )}
                    </div>
                </div>

                {merchantOverridesDirty && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
                        You have unsaved See It Now overrides. Click <strong>Save</strong> to regenerate and persist the v2 prompt pack.
                    </div>
                )}
            </Card>

            {/* SECTION 2: Placement Prompts (See It and See It Now) */}
            <Card className="space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-[#1A1A1A]">Placement Prompts</h3>
                        <p className="text-sm text-[#737373] mt-1">
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
                            <label className="block text-sm font-semibold text-[#1A1A1A]">
                                See It prompt
                            </label>
                            <p className="text-xs text-[#737373] mt-0.5">
                                Used for full See It flow
                            </p>
                        </div>
                        <div className="relative">
                            {showEditWarning && (
                                <div className="absolute -top-2 left-0 right-0 bg-amber-50 border border-amber-200 rounded-xl p-3 z-10 shadow-lg">
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

                            <div className={`bg-[#171717] rounded-xl p-4 ${showEditWarning ? 'mt-16' : ''}`}>
                                {description ? (
                                    <textarea
                                        value={description}
                                        onChange={(e) => handleDescriptionEdit(e.target.value)}
                                        className="w-full bg-transparent text-white text-sm leading-relaxed resize-none focus:outline-none min-h-[120px]"
                                        placeholder="Click 'Generate Prompt' to create a placement prompt..."
                                    />
                                ) : (
                                    <div className="text-[#A3A3A3] text-sm py-8 text-center">
                                        <p>No placement prompt yet.</p>
                                        <p className="mt-1">Review the fields above, then click <strong>Generate Prompt</strong>.</p>
                                    </div>
                                )}
                            </div>

                            {description && (
                                <div className="flex items-center justify-between mt-2 px-1">
                                    <span className="text-xs text-[#A3A3A3]">
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
                            <label className="block text-sm font-semibold text-[#1A1A1A]">
                                See It Now prompt
                            </label>
                            <p className="text-xs text-[#737373] mt-0.5">
                                Used for instant See It Now flow. Leave blank to use the See It prompt.
                            </p>
                        </div>
                        <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-4">
                            <textarea
                                value={seeItNowPrompt}
                                onChange={(e) => {
                                    setSeeItNowPrompt(e.target.value);
                                    setSeeItNowDirty(true);
                                }}
                                className="w-full bg-transparent text-[#1A1A1A] text-sm leading-relaxed resize-none focus:outline-none min-h-[120px]"
                                placeholder="Leave blank to use the See It prompt..."
                            />
                            {seeItNowPrompt && (
                                <div className="flex items-center justify-between mt-2 px-1">
                                    <span className="text-xs text-[#A3A3A3]">
                                        {seeItNowPrompt.length} characters
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </Card>



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
            <Card className="pt-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-semibold text-[#1A1A1A]">
                            Enable for customers
                        </h3>
                        <p className="text-xs text-[#737373] mt-0.5">
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
                        <div className="flex items-center gap-2 text-sm text-[#737373]">
                            <span className="w-2 h-2 rounded-full bg-[#A3A3A3]"></span>
                            Prepare the product first to enable
                        </div>
                    ) : enabled ? (
                        <div className="flex items-center gap-2 text-sm text-emerald-600">
                            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                            Customers can see this product in their space
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 text-sm text-[#737373]">
                            <span className="w-2 h-2 rounded-full bg-[#A3A3A3]"></span>
                            Enable to show on your store
                        </div>
                    )}
                </div>
            </Card>
        </div>
    );
}
