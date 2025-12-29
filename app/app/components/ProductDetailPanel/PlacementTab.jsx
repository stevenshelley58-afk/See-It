import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '../ui';

// Helper: Auto-detect metadata from title (from demo)
function detectMetadata(title) {
    const t = title.toLowerCase();

    let surface = 'floor';
    if (t.includes('wall') || t.includes('art') || t.includes('painting') || t.includes('poster')) {
        surface = 'wall';
    } else if (t.includes('lamp') || t.includes('vase') || t.includes('decor') || t.includes('candle')) {
        surface = 'table';
    } else if (t.includes('pendant') || t.includes('chandelier')) {
        surface = 'ceiling';
    }

    let orientation = 'upright';
    if (t.includes('mirror') && surface === 'floor') {
        orientation = 'leaning';
    } else if (surface === 'wall') {
        orientation = 'wall-mounted';
    } else if (t.includes('rug') || t.includes('mat')) {
        orientation = 'flat';
    } else if (surface === 'ceiling') {
        orientation = 'hanging';
    }

    let material = 'matte';
    if (t.includes('mirror') || t.includes('chrome') || t.includes('glass') || t.includes('metal')) {
        material = 'reflective';
    } else if (t.includes('velvet') || t.includes('fabric') || t.includes('upholstered') || t.includes('linen')) {
        material = 'fabric';
    } else if (t.includes('gloss') || t.includes('lacquer')) {
        material = 'gloss';
    }

    return { surface, orientation, material };
}

// Helper: Generate prompt preview (from demo)
function generatePromptPreview(meta) {
    let parts = [];

    if (meta.surface) parts.push(`This product belongs on the <strong>${meta.surface.toUpperCase()}</strong>.`);
    if (meta.orientation) parts.push(`Position: <strong>${meta.orientation.toUpperCase()}</strong>.`);
    if (meta.material) parts.push(`Material: <strong>${meta.material.toUpperCase()}</strong> finish.`);
    if (meta.shadow) parts.push(`Shadow: <strong>${meta.shadow.toUpperCase()}</strong>.`);

    if (meta.surface === 'floor') {
        parts.push('The bottom edge must rest firmly on the floor plane.');
    }
    if (meta.orientation === 'leaning') {
        parts.push('Position at a slight angle (5-15°) against the wall.');
    }
    if (meta.material === 'reflective') {
        parts.push('Show subtle environment reflections.');
    }
    if (meta.dimensions?.height || meta.dimensions?.width) {
        const dims = [];
        if (meta.dimensions.height) dims.push(`${meta.dimensions.height}cm tall`);
        if (meta.dimensions.width) dims.push(`${meta.dimensions.width}cm wide`);
        parts.push(`Real-world size: ${dims.join(', ')}.`);
    }
    if (meta.customInstructions) {
        parts.push(meta.customInstructions);
    }

    return parts.join(' ');
}

/**
 * PlacementTab - Content for the "Placement Settings" tab in ProductDetailPanel.
 */
export function PlacementTab({ product, asset, onChange }) {
    // Parse initial metadata from asset.renderInstructions
    const initialMetadata = useMemo(() => {
        try {
            if (asset?.renderInstructions && asset.renderInstructions.startsWith('{')) {
                return JSON.parse(asset.renderInstructions);
            }
        } catch (e) {
            console.error("Failed to parse renderInstructions", e);
        }

        // Fallback to auto-detection
        const detected = detectMetadata(product.title);
        return {
            ...detected,
            shadow: 'contact',
            dimensions: { height: null, width: null },
            customInstructions: ''
        };
    }, [asset, product.title]);

    const [metadata, setMetadata] = useState(initialMetadata);

    // Notify parent on change
    useEffect(() => {
        if (onChange) {
            onChange(metadata);
        }
    }, [metadata, onChange]);

    const updateField = (field, value) => {
        if (field.includes('.')) {
            const [parent, child] = field.split('.');
            setMetadata(prev => ({
                ...prev,
                [parent]: {
                    ...prev[parent],
                    [child]: value
                }
            }));
        } else {
            setMetadata(prev => ({ ...prev, [field]: value }));
        }
    };

    const surfaces = ['floor', 'wall', 'table', 'ceiling', 'shelf'];
    const orientations = ['upright', 'flat', 'leaning', 'wall-mounted', 'hanging', 'draped'];
    const materials = ['matte', 'semi-gloss', 'gloss', 'reflective', 'transparent', 'fabric'];
    const shadows = ['contact', 'cast', 'soft', 'none'];

    const detected = useMemo(() => detectMetadata(product.title), [product.title]);

    return (
        <div className="space-y-6 fade-in">
            {/* Auto-detection Hint */}
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
                <div className="bg-amber-500/10 p-1.5 rounded-lg shrink-0">
                    <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                </div>
                <div className="text-sm text-amber-800">
                    <p className="font-bold">Auto-detected placement hints</p>
                    <p className="opacity-90">
                        Based on the title, we suggest: <strong>{detected.surface}</strong>, <strong>{detected.orientation}</strong>, <strong>{detected.material}</strong>. Adjust as needed.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="space-y-6">
                    {/* Surface Selection */}
                    <div className="space-y-3">
                        <label className="block text-sm font-semibold text-neutral-900">Where does this product go?</label>
                        <div className="flex flex-wrap gap-2">
                            {surfaces.map(s => (
                                <button
                                    key={s}
                                    onClick={() => updateField('surface', s)}
                                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${metadata.surface === s
                                            ? 'bg-neutral-900 text-white shadow-md transform scale-105'
                                            : 'bg-white border border-neutral-200 text-neutral-600 hover:border-neutral-400 hover:bg-neutral-50'
                                        }`}
                                >
                                    {s.charAt(0).toUpperCase() + s.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Orientation */}
                    <div className="space-y-3">
                        <label className="block text-sm font-semibold text-neutral-900">How is it positioned?</label>
                        <div className="flex flex-wrap gap-2">
                            {orientations.map(o => (
                                <button
                                    key={o}
                                    onClick={() => updateField('orientation', o)}
                                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${metadata.orientation === o
                                            ? 'bg-neutral-900 text-white shadow-md transform scale-105'
                                            : 'bg-white border border-neutral-200 text-neutral-600 hover:border-neutral-400 hover:bg-neutral-50'
                                        }`}
                                >
                                    {o.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Material */}
                    <div className="space-y-3">
                        <label className="block text-sm font-semibold text-neutral-900">Main material / finish?</label>
                        <div className="flex flex-wrap gap-2">
                            {materials.map(m => (
                                <button
                                    key={m}
                                    onClick={() => updateField('material', m)}
                                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${metadata.material === m
                                            ? 'bg-neutral-900 text-white shadow-md transform scale-105'
                                            : 'bg-white border border-neutral-200 text-neutral-600 hover:border-neutral-400 hover:bg-neutral-50'
                                        }`}
                                >
                                    {m.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Shadow */}
                    <div className="space-y-3">
                        <label className="block text-sm font-semibold text-neutral-900">Shadow type?</label>
                        <div className="flex flex-wrap gap-2">
                            {shadows.map(s => (
                                <button
                                    key={s}
                                    onClick={() => updateField('shadow', s)}
                                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${metadata.shadow === s
                                            ? 'bg-neutral-900 text-white shadow-md transform scale-105'
                                            : 'bg-white border border-neutral-200 text-neutral-600 hover:border-neutral-400 hover:bg-neutral-50'
                                        }`}
                                >
                                    {s.charAt(0).toUpperCase() + s.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="space-y-6">
                    {/* Dimensions */}
                    <div className="space-y-3">
                        <label className="block text-sm font-semibold text-neutral-900">Real-world dimensions (optional)</label>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="relative">
                                <input
                                    type="number"
                                    placeholder="Height"
                                    value={metadata.dimensions?.height || ''}
                                    onChange={(e) => updateField('dimensions.height', e.target.value ? parseInt(e.target.value) : null)}
                                    className="w-full pl-4 pr-12 py-3 bg-white border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900/10 focus:border-neutral-400 transition-all"
                                />
                                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-400">CM</span>
                            </div>
                            <div className="relative">
                                <input
                                    type="number"
                                    placeholder="Width"
                                    value={metadata.dimensions?.width || ''}
                                    onChange={(e) => updateField('dimensions.width', e.target.value ? parseInt(e.target.value) : null)}
                                    className="w-full pl-4 pr-12 py-3 bg-white border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900/10 focus:border-neutral-400 transition-all"
                                />
                                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-400">CM</span>
                            </div>
                        </div>
                    </div>

                    {/* Custom Instructions */}
                    <div className="space-y-3">
                        <label className="block text-sm font-semibold text-neutral-900">Additional Instructions</label>
                        <textarea
                            placeholder="e.g., 'Ensure the shadow falls slightly to the left to match the window light.'"
                            value={metadata.customInstructions || ''}
                            onChange={(e) => updateField('customInstructions', e.target.value)}
                            className="w-full px-4 py-3 bg-white border border-neutral-200 rounded-xl text-sm min-h-[100px] resize-none focus:outline-none focus:ring-2 focus:ring-neutral-900/10 focus:border-neutral-400 transition-all"
                        />
                    </div>

                    {/* Generated Preview */}
                    <div className="space-y-3">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-neutral-400">AI Prompt Preview</label>
                        <div className="p-4 bg-neutral-900 text-neutral-100 rounded-2xl border border-neutral-800 shadow-inner overflow-hidden relative">
                            <div className="absolute top-0 right-0 p-2 opacity-10">
                                <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" />
                                </svg>
                            </div>
                            <p
                                className="text-sm leading-relaxed"
                                dangerouslySetInnerHTML={{ __html: generatePromptPreview(metadata) }}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
