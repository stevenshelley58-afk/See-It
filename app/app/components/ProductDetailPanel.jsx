import React, { useState, useCallback, useEffect } from 'react';
import { useFetcher } from '@remix-run/react';
import { Button } from './ui';
import { PrepareTab } from './ProductDetailPanel/PrepareTab';
import { PlacementTab } from './ProductDetailPanel/PlacementTab';
import { RefineView } from './ProductDetailPanel/RefineView';

/**
 * ProductDetailPanel - Modal for editing product preparation and placement settings.
 * 
 * Props:
 * - product: Shopify product object (title, handle, images, etc.)
 * - asset: ProductAsset database record (status, preparedImageUrl, renderInstructions, etc.)
 * - isOpen: Boolean to control modal visibility
 * - onClose: Function to close the modal
 * - onSave: Function to save changes
 */
export function ProductDetailPanel({ product, asset, isOpen, onClose, onSave }) {
    const fetcher = useFetcher();
    const [activeTab, setActiveTab] = useState('prepare'); // 'prepare' | 'placement'
    const [pendingMetadata, setPendingMetadata] = useState(null);
    const [isRefining, setIsRefining] = useState(false);

    // Reset state when modal closes or product changes
    useEffect(() => {
        if (!isOpen) {
            setIsRefining(false);
            setActiveTab('prepare');
        }
    }, [isOpen]);

    if (!isOpen || !product) return null;

    const status = asset?.status || 'pending';
    const hasPrepared = !!asset?.preparedImageUrl;

    const handleSave = useCallback(() => {
        if (!pendingMetadata) {
            onClose();
            return;
        }

        const formData = new FormData();
        formData.append("productId", product.id.split('/').pop());

        // Handle both old format (string) and new format (object with renderInstructions and v2Config)
        if (typeof pendingMetadata === 'string') {
            // Old format: just renderInstructions
            formData.append("instructions", pendingMetadata);
        } else if (pendingMetadata && typeof pendingMetadata === 'object') {
            // New format: object with renderInstructions and v2Config
            formData.append("instructions", pendingMetadata.renderInstructions || '');
            if (pendingMetadata.v2Config) {
                if (pendingMetadata.v2Config.sceneRole) {
                    formData.append("sceneRole", pendingMetadata.v2Config.sceneRole);
                }
                if (pendingMetadata.v2Config.replacementRule) {
                    formData.append("replacementRule", pendingMetadata.v2Config.replacementRule);
                }
                if (pendingMetadata.v2Config.allowSpaceCreation !== undefined && pendingMetadata.v2Config.allowSpaceCreation !== null) {
                    formData.append("allowSpaceCreation", pendingMetadata.v2Config.allowSpaceCreation ? 'true' : 'false');
                }
            }
        } else {
            formData.append("instructions", JSON.stringify(pendingMetadata));
        }

        fetcher.submit(formData, {
            method: "post",
            action: "/api/products/update-instructions"
        });

        // Optimistically close or notify parent
        if (onSave) onSave(pendingMetadata);
        onClose();
    }, [product.id, pendingMetadata, fetcher, onClose, onSave]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm transition-opacity duration-300">
            <div
                className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl slide-up"
                onClick={(e) => e.stopPropagation()}
            >
                {isRefining ? (
                    <RefineView
                        product={product}
                        imageUrl={asset?.sourceImageUrl || product.featuredImage?.url}
                        onComplete={(data) => {
                            setIsRefining(false);
                            // Refresh logic could go here
                        }}
                        onCancel={() => setIsRefining(false)}
                    />
                ) : (
                    <>
                        {/* Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
                            <div className="flex items-center gap-3">
                                <h2 className="text-xl font-bold text-neutral-900 tracking-tight">{product.title}</h2>
                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border transition-colors ${(status === 'ready' && hasPrepared) ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                    status === 'failed' ? 'bg-red-50 text-red-700 border-red-200' :
                                        status === 'processing' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                            'bg-neutral-100 text-neutral-600 border-neutral-200'
                                    }`}>
                                    <span className={`w-2 h-2 rounded-full ${(status === 'ready' && hasPrepared) ? 'bg-emerald-500' :
                                        status === 'failed' ? 'bg-red-500' :
                                            status === 'processing' ? 'bg-blue-500 animate-pulse' :
                                                'bg-neutral-400'
                                        }`}></span>
                                    {(status === 'ready' && hasPrepared) ? 'Ready' :
                                        status === 'ready' ? 'Original' :
                                            status.charAt(0).toUpperCase() + status.slice(1)}
                                </span>
                            </div>
                            <button
                                onClick={onClose}
                                className="p-2 hover:bg-neutral-100 rounded-lg transition-colors text-neutral-500 hover:text-neutral-700"
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                                </svg>
                            </button>
                        </div>

                        {/* Tab Navigation */}
                        <div className="flex border-b border-neutral-200 px-6 bg-white shrink-0">
                            <button
                                onClick={() => setActiveTab('prepare')}
                                className={`px-5 py-3.5 text-sm font-semibold border-b-2 transition-all ${activeTab === 'prepare'
                                    ? 'border-neutral-900 text-neutral-900'
                                    : 'border-transparent text-neutral-400 hover:text-neutral-600'
                                    }`}
                            >
                                Prepare Image
                            </button>
                            <button
                                onClick={() => setActiveTab('placement')}
                                className={`px-5 py-3.5 text-sm font-semibold border-b-2 transition-all ${activeTab === 'placement'
                                    ? 'border-neutral-900 text-neutral-900'
                                    : 'border-transparent text-neutral-400 hover:text-neutral-600'
                                    }`}
                            >
                                Placement Settings
                            </button>
                        </div>

                        {/* Content Area */}
                        <div className="flex-1 overflow-y-auto p-6 bg-neutral-50/30">
                            {activeTab === 'prepare' ? (
                                <PrepareTab
                                    product={product}
                                    asset={asset}
                                    onPrepareComplete={() => {
                                        // Optional: any extra logic when auto-remove finishes
                                    }}
                                    onRefine={() => setIsRefining(true)}
                                />
                            ) : (
                                <PlacementTab
                                    product={product}
                                    asset={asset}
                                    onChange={(meta) => setPendingMetadata(meta)}
                                />
                            )}
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-between px-6 py-5 border-t border-neutral-200 bg-white">
                            <Button
                                variant="tertiary"
                                onClick={onClose}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="primary"
                                onClick={handleSave}
                                loading={fetcher.state !== 'idle'}
                            >
                                Save Changes
                            </Button>
                        </div>
                    </>
                )}
            </div>

            {/* Animation Styles */}
            <style dangerouslySetInnerHTML={{
                __html: `
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .slide-up { animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
      `}} />
        </div>
    );
}
