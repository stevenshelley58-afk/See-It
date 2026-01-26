import React, { useState, useCallback, useEffect, useRef } from 'react';
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
    const [placementDirty, setPlacementDirty] = useState(false);
    const [saveError, setSaveError] = useState(null);
    const [saveInfo, setSaveInfo] = useState(null);
    const [isRefining, setIsRefining] = useState(false);
    const [editRequestId, setEditRequestId] = useState(0);
    const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
    const [confirmIntent, setConfirmIntent] = useState(null); // { type: 'close' } | { type: 'tab', tab: 'prepare' | 'placement' }
    const lastSubmittedMetadataRef = useRef(null);

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
            setPendingMetadata(null);
            setPlacementDirty(false);
            setSaveError(null);
            setSaveInfo(null);
            setConfirmDiscardOpen(false);
            setConfirmIntent(null);
        }
    }, [isOpen]);

    // Reset footer config when tab changes
    useEffect(() => {
        setFooterConfig(null);
        setSaveError(null);
        setSaveInfo(null);
    }, [activeTab]);

    if (!isOpen || !product) return null;

    const status = asset?.status || 'pending';
    const hasPrepared = !!(asset?.preparedImageUrlFresh || asset?.preparedImageUrl);
    const isSaving = fetcher.state !== 'idle';
    const shouldWarnUnsaved = activeTab === 'placement' && placementDirty;

    const discardPlacementEdits = useCallback(() => {
        setPendingMetadata(null);
        setPlacementDirty(false);
        setSaveError(null);
        setSaveInfo(null);
    }, []);

    const requestClose = useCallback(() => {
        if (isSaving) return;
        if (shouldWarnUnsaved) {
            setConfirmIntent({ type: 'close' });
            setConfirmDiscardOpen(true);
            return;
        }
        onClose();
    }, [onClose, shouldWarnUnsaved, isSaving]);

    const requestTabChange = useCallback((nextTab) => {
        if (isSaving) return;
        if (nextTab === activeTab) return;
        // Only warn when leaving placement with unsaved edits
        if (activeTab === 'placement' && shouldWarnUnsaved) {
            setConfirmIntent({ type: 'tab', tab: nextTab });
            setConfirmDiscardOpen(true);
            return;
        }
        setActiveTab(nextTab);
    }, [activeTab, shouldWarnUnsaved, isSaving]);

    const handlePlacementSave = useCallback(() => {
        setSaveError(null);
        setSaveInfo(null);

        if (!pendingMetadata) {
            requestClose();
            return;
        }

        lastSubmittedMetadataRef.current = pendingMetadata;

        const formData = new FormData();
        formData.append("productId", product.id.split('/').pop());

        // Only send enabled flag
        if (pendingMetadata && typeof pendingMetadata === 'object') {
            if (pendingMetadata.enabled !== undefined) {
                formData.append("enabled", pendingMetadata.enabled ? 'true' : 'false');
            }
        }

        setSaveInfo("Saving...");
        fetcher.submit(formData, {
            method: "post",
            action: "/api/products/update-instructions"
        });
    }, [product.id, pendingMetadata, fetcher, requestClose]);

    // Close only after we have a save response
    useEffect(() => {
        if (fetcher.state !== 'idle') return;
        if (!fetcher.data) return;

        if (fetcher.data.success) {
            // Mark clean and close
            setPlacementDirty(false);
            setSaveError(null);
            setSaveInfo(fetcher.data.message || "Saved");
            if (onSave) onSave(lastSubmittedMetadataRef.current);
            onClose();
            return;
        }

        setSaveInfo(null);
        setSaveError(fetcher.data.error || "Save failed");
    }, [fetcher.state, fetcher.data, onClose, onSave]);

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
                loading: isSaving,
            },
            secondary: {
                label: 'Cancel',
                onClick: requestClose,
                disabled: isSaving,
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
        <>
            <Modal
                open={isOpen}
                onClose={requestClose}
                title={product.title}
                large
            >
            <Modal.Section>
                {/* Premium Tabs */}
                <div className="flex gap-1 mb-6 -mx-6 px-6 border-b border-[#E5E5E5]">
                    <button
                        onClick={() => requestTabChange('prepare')}
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
                        onClick={() => requestTabChange('placement')}
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

                {/* Save feedback */}
                {(saveError || saveInfo) && (
                    <div className={`mb-4 -mt-2 px-4 py-3 rounded-xl border ${
                        saveError
                            ? 'bg-red-50 border-red-200 text-red-800'
                            : (isSaving
                                ? 'bg-[#FAFAFA] border-[#E5E5E5] text-[#1A1A1A]'
                                : 'bg-emerald-50 border-emerald-200 text-emerald-800')
                    }`}>
                        <div className="text-sm font-semibold">
                            {saveError ? 'Save failed' : (isSaving ? 'Saving…' : 'Saved')}
                        </div>
                        <div className="text-xs mt-1 text-[#737373]">
                            {saveError || saveInfo}
                        </div>
                    </div>
                )}

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
                        onChange={(meta) => {
                            setPendingMetadata(meta);
                            setPlacementDirty(!!meta?.dirty);
                        }}
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

            {/* Discard changes confirm */}
            <Modal
                open={confirmDiscardOpen}
                onClose={() => {
                    setConfirmDiscardOpen(false);
                    setConfirmIntent(null);
                }}
                title="Discard unsaved changes?"
                primaryAction={{
                    content: "Discard changes",
                    destructive: true,
                    onAction: () => {
                        const intent = confirmIntent;
                        setConfirmDiscardOpen(false);
                        setConfirmIntent(null);
                        discardPlacementEdits();
                        if (intent?.type === 'tab' && intent.tab) {
                            setActiveTab(intent.tab);
                        } else {
                            onClose();
                        }
                    }
                }}
                secondaryActions={[
                    {
                        content: "Keep editing",
                        onAction: () => {
                            setConfirmDiscardOpen(false);
                            setConfirmIntent(null);
                        }
                    }
                ]}
            >
                <Modal.Section>
                    <BlockStack gap="200">
                        <Text as="p">
                            You have unsaved changes on the Placement tab. If you discard them, your enabled status change will be lost.
                        </Text>
                    </BlockStack>
                </Modal.Section>
            </Modal>
        </>
    );
}
