// Force update
import React, { useState, useCallback, useEffect } from 'react';
import { useFetcher } from '@remix-run/react';
import { Button } from './ui';
import { PrepareTab } from './ProductDetailPanel/PrepareTab';
import { PlacementTab } from './ProductDetailPanel/PlacementTab';
import { RefineView } from './ProductDetailPanel/RefineView';

/**
 * ProductDetailPanel - Modal for editing product preparation and placement settings.
 */
export function ProductDetailPanel({ product, asset, isOpen, onClose, onSave }) {
    const fetcher = useFetcher();
    const [activeTab, setActiveTab] = useState('prepare'); // 'prepare' | 'placement'
    const [pendingMetadata, setPendingMetadata] = useState(null);
    const [isRefining, setIsRefining] = useState(false);

    // Dynamic Footer Config from children
    // { primary: { label, onClick, disabled, variant }, secondary: { ... }, tertiary: { ... } }
    const [footerConfig, setFooterConfig] = useState(null);

    // Reset state when modal closes
    useEffect(() => {
        if (!isOpen) {
            setIsRefining(false);
            setActiveTab('prepare');
            setFooterConfig(null);
        }
    }, [isOpen]);

    // Reset footer config when tab changes
    useEffect(() => {
        setFooterConfig(null);
    }, [activeTab]);

    if (!isOpen || !product) return null;

    const status = asset?.status || 'pending';
    const hasPrepared = !!asset?.preparedImageUrl;

    const handlePlacementSave = useCallback(() => {
        if (!pendingMetadata) {
            onClose();
            return;
        }

        const formData = new FormData();
        formData.append("productId", product.id.split('/').pop());

        if (typeof pendingMetadata === 'string') {
            formData.append("instructions", pendingMetadata);
        } else if (pendingMetadata && typeof pendingMetadata === 'object') {
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

        if (onSave) onSave(pendingMetadata);
        onClose();
    }, [product.id, pendingMetadata, fetcher, onClose, onSave]);

    // Derived Footer Actions
    const renderFooter = () => {
        // If child provided config, use it
        if (footerConfig) {
            return (
                <div className="flex items-center w-full gap-3 md:justify-end">
                    {/* Mobile: 50/50 buttons, Desktop: Aligned right */}
                    {footerConfig.tertiary && (
                        <div className="mr-auto hidden md:block">
                            <Button
                                variant="tertiary"
                                onClick={footerConfig.tertiary.onClick}
                                disabled={footerConfig.tertiary.disabled}
                                className={footerConfig.tertiary.className}
                            >
                                {footerConfig.tertiary.label}
                            </Button>
                        </div>
                    )}

                    {footerConfig.secondary && (
                        <Button
                            variant="secondary"
                            onClick={footerConfig.secondary.onClick}
                            disabled={footerConfig.secondary.disabled}
                            className={`flex-1 md:flex-none md:min-w-[100px] ${footerConfig.secondary.className || ''}`}
                        >
                            {footerConfig.secondary.label}
                        </Button>
                    )}

                    {footerConfig.primary && (
                        <Button
                            variant="primary"
                            onClick={footerConfig.primary.onClick}
                            disabled={footerConfig.primary.disabled}
                            loading={footerConfig.primary.loading}
                            className={`flex-1 md:flex-none md:min-w-[100px] ${footerConfig.primary.className || ''}`}
                        >
                            {footerConfig.primary.label}
                        </Button>
                    )}
                </div>
            );
        }

        // Default Footer (Placement Tab mostly)
        return (
            <div className="flex items-center w-full gap-3 md:justify-end">
                <Button 
                    variant="secondary" 
                    onClick={onClose}
                    className="flex-1 md:flex-none"
                >
                    Cancel
                </Button>
                <Button
                    variant="primary"
                    onClick={handlePlacementSave}
                    loading={fetcher.state !== 'idle'}
                    className="flex-1 md:flex-none"
                >
                    Save
                </Button>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm transition-opacity duration-300 p-0 sm:p-4 font-['SF_Pro_Display',-apple-system,BlinkMacSystemFont,sans-serif]">
            {/* Modal Container: fixed height layout */}
            <div
                className="bg-white w-full max-w-4xl flex flex-col shadow-2xl relative sm:rounded-2xl overflow-hidden"
                style={{ maxHeight: 'calc(100vh - 64px)', height: 'auto' }}
                onClick={(e) => e.stopPropagation()}
            >
                {isRefining ? (
                    <RefineView
                        product={product}
                        imageUrl={asset?.sourceImageUrl || product.featuredImage?.url}
                        onComplete={(data) => {
                            setIsRefining(false);
                        }}
                        onCancel={() => setIsRefining(false)}
                    />
                ) : (
                    <>
                        {/* 1. Header (Fixed) */}
                        <div className="h-[52px] lg:h-[56px] flex items-center justify-between px-4 lg:px-6 border-b border-neutral-200 bg-white flex-shrink-0 z-10">
                            <h2 className="text-lg font-bold text-neutral-900 truncate pr-4">{product.title}</h2>
                            <button
                                onClick={onClose}
                                className="p-2 hover:bg-neutral-100 rounded-lg transition-colors text-neutral-500 hover:text-neutral-700"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                                </svg>
                            </button>
                        </div>

                        {/* 2. Content Region (Flex) */}
                        <div className="flex-1 flex flex-col min-h-0 bg-white overflow-hidden">
                            {/* Tabs (Fixed at top of Content) */}
                            <div className="flex border-b border-neutral-200 px-4 lg:px-6 shrink-0 h-[44px]">
                                <button
                                    onClick={() => setActiveTab('prepare')}
                                    className={`px-4 h-full text-sm font-semibold border-b-2 transition-all ${activeTab === 'prepare'
                                        ? 'border-neutral-900 text-neutral-900'
                                        : 'border-transparent text-neutral-400 hover:text-neutral-600'
                                        }`}
                                >
                                    Prepare
                                </button>
                                <button
                                    onClick={() => setActiveTab('placement')}
                                    className={`px-4 h-full text-sm font-semibold border-b-2 transition-all ${activeTab === 'placement'
                                        ? 'border-neutral-900 text-neutral-900'
                                        : 'border-transparent text-neutral-400 hover:text-neutral-600'
                                        }`}
                                >
                                    Settings
                                </button>
                            </div>

                            {/* Actual Scrollable/Flex Content */}
                            <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden">
                                {activeTab === 'prepare' ? (
                                    <PrepareTab
                                        product={product}
                                        asset={asset}
                                        onPrepareComplete={() => { }}
                                        onRefine={() => setIsRefining(true)}
                                        setFooterConfig={setFooterConfig}
                                        onSave={onClose}
                                    />
                                ) : (
                                    <div className="flex-1 overflow-y-auto p-4 lg:p-6 bg-neutral-50/30">
                                        <PlacementTab
                                            product={product}
                                            asset={asset}
                                            onChange={(meta) => setPendingMetadata(meta)}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 3. Footer (Fixed) */}
                        <div className="h-[72px] lg:h-[64px] flex items-center px-4 lg:px-6 border-t border-neutral-200 bg-white flex-shrink-0 z-20">
                            {renderFooter()}
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
