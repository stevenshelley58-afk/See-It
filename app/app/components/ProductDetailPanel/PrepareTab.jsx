import React, { useState, useCallback, useEffect } from 'react';
import { useFetcher } from '@remix-run/react';
import { Spinner, Icon } from '@shopify/polaris';
import { Button } from '../ui';

/**
 * PrepareTab - Content for the "Prepare Image" tab in ProductDetailPanel.
 * 
 * Features:
 * - Select source image from product.images
 * - Side-by-side: Original | Prepared (checkerboard)
 * - Auto-remove background via /api/products/remove-background
 * - Loading states and error handling
 */
export function PrepareTab({ product, asset, onPrepareComplete, onRefine }) {
    const fetcher = useFetcher();
    const [selectedImageUrl, setSelectedImageUrl] = useState(
        asset?.sourceImageUrl || product.featuredImage?.url || product.images?.edges?.[0]?.node?.url
    );

    // Track the prepared image locally for immediate feedback after fetcher completes
    const [preparedImageUrl, setPreparedImageUrl] = useState(asset?.preparedImageUrl || asset?.preparedImageUrlFresh);
    const [error, setError] = useState(null);

    // Sync prepared image if asset updates (e.g., from initial load or re-validation)
    useEffect(() => {
        if (asset?.preparedImageUrlFresh || asset?.preparedImageUrl) {
            setPreparedImageUrl(asset.preparedImageUrlFresh || asset.preparedImageUrl);
        }
    }, [asset]);

    // Handle fetcher response
    useEffect(() => {
        if (fetcher.data && fetcher.state === 'idle') {
            if (fetcher.data.success) {
                setPreparedImageUrl(fetcher.data.preparedImageUrl);
                setError(null);
                if (onPrepareComplete) onPrepareComplete(fetcher.data);
            } else {
                setError(fetcher.data.error || 'Failed to remove background');
            }
        }
    }, [fetcher.data, fetcher.state, onPrepareComplete]);

    const handleAutoRemove = useCallback(() => {
        setError(null);
        const formData = new FormData();
        formData.append('productId', product.id.split('/').pop());
        formData.append('imageUrl', selectedImageUrl);

        fetcher.submit(formData, {
            method: 'post',
            action: '/api/products/remove-background'
        });
    }, [product.id, selectedImageUrl, fetcher]);

    const isLoading = fetcher.state !== 'idle';
    const allImages = product.images?.edges?.map(e => e.node) || [];

    return (
        <div className="space-y-8 fade-in">
            {/* Error Badge */}
            {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-700">
                    <svg className="w-5 h-5 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                    <div className="text-sm">
                        <p className="font-semibold">Error removing background</p>
                        <p className="opacity-90">{error}</p>
                    </div>
                </div>
            )}

            {/* Image Selection */}
            {allImages.length > 1 && (
                <div className="space-y-3">
                    <label className="block text-sm font-semibold text-neutral-900">
                        Select Source Image
                    </label>
                    <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                        {allImages.map((img, idx) => (
                            <button
                                key={img.id || idx}
                                disabled={isLoading}
                                onClick={() => setSelectedImageUrl(img.url)}
                                className={`flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden border-2 transition-all duration-200 ${selectedImageUrl === img.url
                                    ? 'border-neutral-900 shadow-lg ring-4 ring-neutral-900/10'
                                    : 'border-neutral-200 hover:border-neutral-400 opacity-60 hover:opacity-100'
                                    }`}
                            >
                                <img src={img.url} alt="" className="w-full h-full object-cover" />
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Comparison View */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Original */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-semibold text-neutral-900">Original Image</label>
                        <span className="text-xs text-neutral-400 font-medium">Shopify Source</span>
                    </div>
                    <div className="aspect-square bg-white rounded-2xl border border-neutral-200 overflow-hidden shadow-sm flex items-center justify-center relative">
                        <img
                            src={selectedImageUrl}
                            alt="Original"
                            className="w-full h-full object-contain p-4"
                        />
                        {isLoading && (
                            <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] flex items-center justify-center">
                                <div className="bg-white p-3 rounded-full shadow-xl">
                                    <Spinner size="small" />
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Prepared */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-semibold text-neutral-900">
                            {preparedImageUrl ? 'Prepared (Transparent)' : 'Result Preview'}
                        </label>
                        {preparedImageUrl && (
                            <span className="flex items-center gap-1 text-xs text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full">
                                <span className="w-1 h-1 bg-emerald-500 rounded-full animate-pulse"></span>
                                ACTIVE
                            </span>
                        )}
                    </div>
                    <div
                        className={`aspect-square rounded-2xl border overflow-hidden shadow-sm flex items-center justify-center relative transition-all duration-300 ${preparedImageUrl
                            ? 'border-emerald-300 border-2'
                            : 'border-neutral-200 border-dashed bg-neutral-50/50'
                            }`}
                        style={{
                            backgroundImage: preparedImageUrl ? 'repeating-conic-gradient(#f0f0f0 0% 25%, #fff 0% 50%) 50% / 24px 24px' : 'none'
                        }}
                    >
                        {isLoading ? (
                            <div className="flex flex-col items-center gap-4 animate-in fade-in zoom-in duration-300">
                                <div className="relative">
                                    <div className="w-12 h-12 border-4 border-neutral-100 border-t-neutral-900 rounded-full animate-spin"></div>
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="w-2 h-2 bg-neutral-900 rounded-full animate-ping"></div>
                                    </div>
                                </div>
                                <div className="text-center">
                                    <p className="text-sm font-bold text-neutral-900">AI Processing...</p>
                                    <p className="text-xs text-neutral-500 mt-1">Isolating product from background</p>
                                </div>
                            </div>
                        ) : preparedImageUrl ? (
                            <img
                                src={preparedImageUrl}
                                alt="Prepared"
                                className="w-full h-full object-contain p-4 drop-shadow-2xl animate-in zoom-in-95 duration-500"
                            />
                        ) : (
                            <div className="flex flex-col items-center gap-3 text-neutral-400 p-8 text-center">
                                <div className="p-4 bg-white rounded-full border border-neutral-100 shadow-sm">
                                    <svg className="w-8 h-8 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                                    </svg>
                                </div>
                                <p className="text-sm font-medium">No prepared image yet</p>
                                <p className="text-xs opacity-60">Click "Auto Remove" to isolate the product using AI.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row items-center gap-4 pt-4 border-t border-neutral-100">
                <Button
                    variant="primary"
                    onClick={handleAutoRemove}
                    disabled={isLoading}
                    className="w-full sm:w-auto min-w-[200px]"
                >
                    {isLoading ? (
                        <span className="flex items-center gap-2">
                            <Spinner size="small" /> Running AI...
                        </span>
                    ) : preparedImageUrl ? 'Re-generate Background' : 'Auto Remove Background'}
                </Button>

                {preparedImageUrl && (
                    <Button
                        variant="secondary"
                        onClick={onRefine}
                        className="w-full sm:w-auto"
                    >
                        Refine Edges
                    </Button>
                )}

                <Button
                    variant="tertiary"
                    onClick={() => {/* Upload logic here */ }}
                    className="w-full sm:w-auto"
                >
                    Upload Instead
                </Button>
            </div>

            {/* Success Banner */}
            {preparedImageUrl && !isLoading && (
                <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl flex items-start gap-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="bg-emerald-500/10 p-1.5 rounded-lg">
                        <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"></path>
                        </svg>
                    </div>
                    <div className="text-sm text-emerald-800">
                        <p className="font-bold">Image ready!</p>
                        <p className="opacity-90">The background has been removed. You can now adjust placement settings for realistic staging.</p>
                    </div>
                </div>
            )}

            <style dangerouslySetInnerHTML={{
                __html: `
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}} />
        </div>
    );
}
