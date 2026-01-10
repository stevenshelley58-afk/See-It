import React, { useState, useCallback, useEffect } from 'react';
import { useFetcher } from '@remix-run/react';
import { Modal, BlockStack, Text } from '@shopify/polaris';
import { PrepareTab } from './ProductDetailPanel/PrepareTab';
import { PlacementTab } from './ProductDetailPanel/PlacementTab';
import { RefineView } from './ProductDetailPanel/RefineView';
import { Button } from './ui';

/**
 * ProductDetailPanel - Modal for editing product preparation and placement settings.
 */
export function ProductDetailPanel({ product, asset, isOpen, onClose, onSave }) {
    const fetcher = useFetcher();
    const [activeTab, setActiveTab] = useState('prepare'); // 'prepare' | 'placement'
    const [pendingMetadata, setPendingMetadata] = useState(null);
    const [isRefining, setIsRefining] = useState(false);
    const [editRequestId, setEditRequestId] = useState(0);

    // Dynamic Footer Config from children
    // { primary: { label, onClick, disabled, variant }, secondary: { ... }, tertiary: { ... } }
    const [footerConfig, setFooterConfig] = useState(null);

    // Reset state when modal closes
    useEffect(() => {
        if (!isOpen) {
            setIsRefining(false);
            setActiveTab('prepare');
            setFooterConfig(null);
            setEditRequestId(0);
        }
    }, [isOpen]);

    // Reset footer config when tab changes
    useEffect(() => {
        setFooterConfig(null);
    }, [activeTab]);

    if (!isOpen || !product) return null;

    const status = asset?.status || 'pending';
    const hasPrepared = !!(asset?.preparedImageUrlFresh || asset?.preparedImageUrl);

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

    // Get footer config for custom footer
    const getFooterConfig = () => {
        // If child provided config, use it
        if (footerConfig) {
            return footerConfig;
        }

        // Default Footer
        // Note: Prepare tab actions are normally set by PrepareTab via setFooterConfig.
        // This fallback ensures "Edit" is visible immediately (no flicker) even before the child effect runs.
        if (activeTab === 'prepare') {
            return {
                primary: {
                    label: 'Save',
                    onClick: onClose, // PrepareTab will override quickly; keep safe default
                    disabled: false,
                    loading: false,
                },
                secondary: {
                    label: 'Edit',
                    onClick: () => setEditRequestId((x) => x + 1),
                    disabled: !hasPrepared,
                },
                tertiary: null,
            };
        }

        // Placement tab default
        return {
            primary: {
                label: 'Save',
                onClick: handlePlacementSave,
                disabled: false,
                loading: fetcher.state !== 'idle',
            },
            secondary: {
                label: 'Cancel',
                onClick: onClose,
                disabled: false,
            },
            tertiary: null,
        };
    };

    if (isRefining) {
        // Refine view uses its own full-screen modal
        return (
            <RefineView
                product={product}
                imageUrl={asset?.sourceImageUrl || product.featuredImage?.url}
                onComplete={(data) => {
                    setIsRefining(false);
                }}
                onCancel={() => setIsRefining(false)}
            />
        );
    }

    const footerConfigData = getFooterConfig();
    
    return (
        <Modal
            open={isOpen}
            onClose={onClose}
            title={product.title}
            large
        >
            <Modal.Section>
                {/* Premium Tabs */}
                <div className="flex gap-1 mb-6 -mx-6 px-6 border-b border-[#E5E5E5]">
                    <button
                        onClick={() => setActiveTab('prepare')}
                        className={`px-4 py-3 text-sm font-semibold transition-all relative ${
                            activeTab === 'prepare'
                                ? 'text-[#1A1A1A]'
                                : 'text-[#737373] hover:text-[#1A1A1A]'
                        }`}
                    >
                        Prepare Image
                        {activeTab === 'prepare' && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#171717] rounded-t-full" />
                        )}
                    </button>
                    <button
                        onClick={() => setActiveTab('placement')}
                        className={`px-4 py-3 text-sm font-semibold transition-all relative ${
                            activeTab === 'placement'
                                ? 'text-[#1A1A1A]'
                                : 'text-[#737373] hover:text-[#1A1A1A]'
                        }`}
                    >
                        Placement
                        {activeTab === 'placement' && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#171717] rounded-t-full" />
                        )}
                    </button>
                </div>

                {/* Tab Content */}
                {activeTab === 'prepare' ? (
                    <PrepareTab
                        product={product}
                        asset={asset}
                        onPrepareComplete={() => { }}
                        onRefine={() => setIsRefining(true)}
                        setFooterConfig={setFooterConfig}
                        onSave={onClose}
                        editRequestId={editRequestId}
                    />
                ) : (
                    <PlacementTab
                        product={product}
                        asset={asset}
                        onChange={(meta) => setPendingMetadata(meta)}
                    />
                )}
            </Modal.Section>

            {/* Custom Premium Footer */}
            <div className="border-t border-[#E5E5E5] bg-white px-6 py-4 flex items-center justify-between gap-3">
                <div className="flex-1" />
                <div className="flex items-center gap-3">
                    {footerConfigData.tertiary && (
                        <Button
                            variant="tertiary"
                            onClick={footerConfigData.tertiary.onClick}
                            disabled={footerConfigData.tertiary.disabled}
                        >
                            {footerConfigData.tertiary.label}
                        </Button>
                    )}
                    {footerConfigData.secondary && (
                        <Button
                            variant="secondary"
                            onClick={footerConfigData.secondary.onClick}
                            disabled={footerConfigData.secondary.disabled}
                        >
                            {footerConfigData.secondary.label}
                        </Button>
                    )}
                    {footerConfigData.primary && (
                        <Button
                            variant="primary"
                            onClick={footerConfigData.primary.onClick}
                            disabled={footerConfigData.primary.disabled || footerConfigData.primary.loading}
                            className={footerConfigData.primary.loading ? "opacity-75 cursor-not-allowed" : ""}
                        >
                            {footerConfigData.primary.loading ? (
                                <span className="flex items-center gap-2">
                                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    {footerConfigData.primary.label}
                                </span>
                            ) : (
                                footerConfigData.primary.label
                            )}
                        </Button>
                    )}
                </div>
            </div>
        </Modal>
    );
}
