import React, { useState, useCallback, useEffect } from 'react';
import { useFetcher } from '@remix-run/react';
import { Modal, BlockStack, Text } from '@shopify/polaris';
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

    // Derived Footer Actions for Polaris Modal
    const getModalActions = () => {
        // If child provided config, use it
        if (footerConfig) {
            const primary = footerConfig.primary ? {
                content: footerConfig.primary.label,
                onAction: footerConfig.primary.onClick,
                disabled: footerConfig.primary.disabled,
                loading: footerConfig.primary.loading,
            } : null;
            
            const secondary = footerConfig.secondary ? [{
                content: footerConfig.secondary.label,
                onAction: footerConfig.secondary.onClick,
                disabled: footerConfig.secondary.disabled,
            }] : [];
            
            // Add tertiary as a destructive secondary action if present
            if (footerConfig.tertiary) {
                secondary.push({
                    content: footerConfig.tertiary.label,
                    onAction: footerConfig.tertiary.onClick,
                    disabled: footerConfig.tertiary.disabled,
                    destructive: true,
                });
            }
            
            return { primary, secondary };
        }

        // Default Footer (Placement Tab mostly)
        return {
            primary: {
                content: 'Save',
                onAction: handlePlacementSave,
                loading: fetcher.state !== 'idle',
            },
            secondary: [{
                content: 'Cancel',
                onAction: onClose,
            }],
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

    const tabs = [
        {
            id: 'prepare',
            content: 'Prepare Image',
            panelID: 'prepare-panel',
        },
        {
            id: 'placement',
            content: 'Placement',
            panelID: 'placement-panel',
        },
    ];

    const modalActions = getModalActions();
    
    return (
        <Modal
            open={isOpen}
            onClose={onClose}
            title={product.title}
            primaryAction={modalActions.primary}
            secondaryActions={modalActions.secondary}
            large
        >
            <Modal.Section>
                <Tabs tabs={tabs} selected={activeTab === 'prepare' ? 0 : 1} onSelect={(selectedTabIndex) => {
                    setActiveTab(tabs[selectedTabIndex].id);
                }}>
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
                        <PlacementTab
                            product={product}
                            asset={asset}
                            onChange={(meta) => setPendingMetadata(meta)}
                        />
                    )}
                </Tabs>
            </Modal.Section>
        </Modal>
    );
}
