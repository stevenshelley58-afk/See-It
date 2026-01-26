import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card } from '../ui';
import { buildPlacementTabMetadata } from './placementTabMetadata';


/**
 * PlacementTab - Product preparation for rendering
 *
 * Fields (from ProductAsset):
 * - extractedFacts: LLM output from batch prep (read-only)
 * - resolvedFacts: merged facts (read-only)
 * - merchantOverrides: sparse merchant edits (dimensions, material)
 *
 * Flow:
 * 1. Batch prep extracts product facts and generates placement prompts
 * 2. Merchant reviews and can adjust dimensions/material
 * 3. Merchant enables/disables product for customers
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
    const labelText = `${product.title} ${tagsText} ${product.productType || ''} ${product.vendor || ''}`.toLowerCase();
    const contextText = `${descriptionText} ${metafieldText}`.toLowerCase();
    const allText = `${labelText} ${contextText}`.toLowerCase();

    // Surface detection
    const surfaceKeywords = {
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
        /\btable\b/i.test(contextText);

    const isFloorFurnitureByLabel =
        /\btable\b/i.test(labelText) ||
        /\bdesk\b/i.test(labelText) ||
        /\bconsole\b/i.test(labelText) ||
        /\bcredenza\b/i.test(labelText) ||
        /\bsideboard\b/i.test(labelText);

    let surface = 'floor';

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
    let dimensions = extractDimsFromMetafields(product);
    if (!dimensions.height && !dimensions.width) {
        dimensions = extractDimsFromText(descriptionText);
    }

    return { surface, material, orientation, dimensions };
}


function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

// ============================================================================
// COMPONENT
// ============================================================================

export function PlacementTab({ product, asset, onChange }) {
    // Auto-detect initial fields (fallback if no saved data)
    const detectedFields = useMemo(() => autoDetectFields(product), [product]);

    // Check if batch prep has run (has extracted facts)
    const hasExtractedFacts = useMemo(() => {
        return isPlainObject(asset?.extractedFacts) || isPlainObject(asset?.resolvedFacts);
    }, [asset?.extractedFacts, asset?.resolvedFacts]);

    // Get initial values from asset or auto-detection
    // Priority: merchantOverrides > resolvedFacts > extractedFacts > autoDetect
    const initialFields = useMemo(() => {
        const overrides = isPlainObject(asset?.merchantOverrides) ? asset.merchantOverrides : null;
        const resolved = isPlainObject(asset?.resolvedFacts) ? asset.resolvedFacts : null;
        const extracted = isPlainObject(asset?.extractedFacts) ? asset.extractedFacts : null;
        const facts = resolved || extracted;

        // Get dimensions: overrides > facts > detected
        let dimensions = { height: null, width: null };
        if (overrides?.dimensions_cm) {
            dimensions = {
                height: overrides.dimensions_cm.h ?? null,
                width: overrides.dimensions_cm.w ?? null,
            };
        } else if (facts?.typical_dimensions_cm) {
            dimensions = facts.typical_dimensions_cm;
        } else if (detectedFields.dimensions) {
            dimensions = detectedFields.dimensions;
        }

        // Get material: overrides > facts > detected
        let material = detectedFields.material;
        if (overrides?.material_profile?.primary) {
            material = overrides.material_profile.primary;
        } else if (facts?.material_profile?.primary) {
            material = facts.material_profile.primary;
        }

        // Surface and orientation are auto-detected read-only values
        const surface = detectedFields.surface;
        const orientation = detectedFields.orientation;

        return { surface, material, orientation, dimensions };
    }, [asset?.merchantOverrides, asset?.resolvedFacts, asset?.extractedFacts, detectedFields]);

    // Track original values for dirty detection
    const originalFields = useMemo(() => initialFields, [initialFields]);

    // State
    const [fields, setFields] = useState(initialFields);
    const [enabled, setEnabled] = useState(asset?.enabled || false);

    // Sync enabled state with asset prop changes
    useEffect(() => {
        setEnabled(asset?.enabled || false);
    }, [asset?.enabled]);

    // Update fields when asset changes (e.g., async load)
    useEffect(() => {
        setFields(initialFields);
    }, [initialFields]);

    // Hydrate missing dimensions from server-side extraction
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
                // silent
            }
        })();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [product?.id]);

    // Notify parent when any editable field changes
    useEffect(() => {
        if (onChange) {
            onChange(buildPlacementTabMetadata({
                enabled,
                originalEnabled: asset?.enabled || false,
                dimensions: fields.dimensions,
                originalDimensions: originalFields.dimensions,
                material: fields.material,
                originalMaterial: originalFields.material,
            }));
        }
    }, [enabled, fields.dimensions, fields.material, asset?.enabled, originalFields, onChange]);

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

    // Options for material
    const materials = ['fabric', 'wood', 'metal', 'glass', 'ceramic', 'stone', 'leather', 'mixed', 'other'];

    // Format display values
    const formatSurface = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Unknown';
    const formatOrientation = (o) => o ? o.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : 'Unknown';

    return (
        <div className="space-y-6 fade-in -mx-6 px-6 py-6 bg-[#FAFAFA]">
            {/* SECTION 1: Product Properties */}
            <Card className="space-y-6">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-[#1A1A1A]">Product Properties</h3>
                    {hasExtractedFacts ? (
                        <span className="text-xs text-[#737373] bg-[#F0F0F0] px-2 py-1 rounded-full">
                            Auto-detected
                        </span>
                    ) : (
                        <span className="text-xs text-[#737373] bg-[#F0F0F0] px-2 py-1 rounded-full">
                            Not detected yet
                        </span>
                    )}
                </div>

                {/* Read-only detected values */}
                <div className="flex flex-wrap gap-3">
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-[#737373]">Detected Placement:</span>
                        <span className="px-3 py-1 bg-[#F0F0F0] text-[#1A1A1A] text-sm font-medium rounded-full">
                            {formatSurface(fields.surface)}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-[#737373]">Orientation:</span>
                        <span className="px-3 py-1 bg-[#F0F0F0] text-[#1A1A1A] text-sm font-medium rounded-full">
                            {formatOrientation(fields.orientation)}
                        </span>
                    </div>
                </div>

                <div className="border-t border-[#E5E5E5] pt-6">
                    {/* Material - Editable */}
                    <div className="space-y-2 mb-6">
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

                    {/* Dimensions - Editable */}
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-[#1A1A1A]">
                            Product Dimensions (cm) <span className="font-normal text-[#A3A3A3]">(optional)</span>
                        </label>
                        <p className="text-xs text-[#737373]">
                            Used to help the AI keep proportions consistent
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
                </div>
            </Card>

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
