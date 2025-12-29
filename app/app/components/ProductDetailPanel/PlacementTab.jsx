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

// Auto-detect fields from product title/description (client-side quick version)
function autoDetectFields(product) {
    const allText = `${product.title} ${product.description || ''} ${product.productType || ''}`.toLowerCase();
    
    // Surface detection
    const surfaceKeywords = {
        floor: ['sofa', 'couch', 'chair', 'bed', 'dresser', 'cabinet', 'bookshelf', 'rug', 'carpet', 'bench', 'ottoman', 'table', 'desk', 'console'],
        wall: ['mirror', 'art', 'painting', 'print', 'poster', 'frame', 'canvas', 'clock', 'sconce', 'shelf'],
        table: ['lamp', 'vase', 'planter', 'candle', 'sculpture', 'figurine', 'bowl', 'tray', 'ornament'],
        ceiling: ['pendant', 'chandelier', 'hanging'],
    };
    
    let surface = 'floor';
    for (const [surf, keywords] of Object.entries(surfaceKeywords)) {
        if (keywords.some(k => allText.includes(k))) {
            surface = surf;
            break;
        }
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
    let dimensions = { height: null, width: null };
    const dimMatch = (product.description || '').match(/(\d+)\s*(?:cm)?\s*[x×]\s*(\d+)/i);
    if (dimMatch) {
        dimensions = { height: parseInt(dimMatch[1]), width: parseInt(dimMatch[2]) };
    }
    
    return { surface, material, orientation, dimensions };
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
    
    // Auto-detect initial fields
    const detectedFields = useMemo(() => autoDetectFields(product), [product]);
    
    // State
    const [fields, setFields] = useState({
        surface: detectedFields.surface,
        material: detectedFields.material,
        orientation: detectedFields.orientation,
        shadow: detectedFields.surface === 'ceiling' ? 'none' : 'contact',
        dimensions: detectedFields.dimensions,
        additionalNotes: '',
    });
    
    const [description, setDescription] = useState(existingDescription || '');
    const [isGenerating, setIsGenerating] = useState(false);
    const [hasEdited, setHasEdited] = useState(false);
    const [showEditWarning, setShowEditWarning] = useState(false);
    
    // Notify parent when description changes
    useEffect(() => {
        if (onChange && description) {
            // Pass the prose description directly (not JSON)
            onChange(description);
        }
    }, [description, onChange]);
    
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
                console.error('Failed to generate description:', data.error);
            }
        } catch (error) {
            console.error('Error generating description:', error);
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
                        Real-World Dimensions <span className="font-normal text-neutral-400">(optional but helpful)</span>
                    </label>
                    <div className="grid grid-cols-2 gap-4 max-w-xs">
                        <div className="relative">
                            <input
                                type="number"
                                placeholder="Height"
                                value={fields.dimensions?.height || ''}
                                onChange={(e) => updateField('dimensions.height', e.target.value ? parseInt(e.target.value) : null)}
                                className="w-full pl-3 pr-10 py-2 bg-white border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400">cm</span>
                        </div>
                        <div className="relative">
                            <input
                                type="number"
                                placeholder="Width"
                                value={fields.dimensions?.width || ''}
                                onChange={(e) => updateField('dimensions.width', e.target.value ? parseInt(e.target.value) : null)}
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
            
            {/* SECTION 2: AI Description */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-neutral-900">AI Render Description</h3>
                        <p className="text-sm text-neutral-500 mt-1">
                            This description tells the AI how to render your product in room photos.
                        </p>
                    </div>
                    <Button
                        variant="primary"
                        onClick={handleGenerate}
                        loading={isGenerating}
                        disabled={isGenerating}
                    >
                        {description ? 'Regenerate' : 'Generate Description'}
                    </Button>
                </div>
                
                {/* Description Box */}
                <div className="relative">
                    {showEditWarning && (
                        <div className="absolute -top-2 left-4 right-4 bg-amber-50 border border-amber-200 rounded-lg p-3 z-10 shadow-lg">
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
                                placeholder="Click 'Generate Description' to create an optimised description..."
                            />
                        ) : (
                            <div className="text-neutral-400 text-sm py-8 text-center">
                                <p>No description yet.</p>
                                <p className="mt-1">Review the fields above, then click <strong>Generate Description</strong>.</p>
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
            
            {/* Status Message */}
            {description && !hasEdited && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-3">
                    <svg className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                    <div>
                        <p className="text-sm font-semibold text-emerald-800">Ready to save</p>
                        <p className="text-xs text-emerald-700 mt-1">
                            This description will be used for all AR renders of this product.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
