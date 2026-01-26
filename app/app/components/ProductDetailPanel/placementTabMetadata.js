/**
 * Build metadata from PlacementTab for saving.
 *
 * Only includes canonical fields that exist in the current schema:
 * - merchantOverrides (sparse diff for fact overrides)
 * - enabled (toggle for customer visibility)
 *
 * Legacy fields (renderInstructions, placementFields, etc.) have been removed.
 */
export function buildPlacementTabMetadata({
    description,
    seeItNowPrompt,
    seeItNowDirty,
    fields,
    placementRulesFields,
    merchantOverrides,
    merchantOverridesDirty,
    hasEdited,
    enabled,
    originalEnabled,
}) {
    const baselineEnabled = originalEnabled || false;
    const enabledDirty = enabled !== baselineEnabled;

    return {
        // Canonical fields only
        merchantOverrides: merchantOverrides,
        merchantOverridesDirty: merchantOverridesDirty,
        enabled: enabledDirty ? enabled : undefined,
        dirty: !!merchantOverridesDirty || enabledDirty,

        // UI-only fields for Generate Prompt feature (not saved to DB)
        _uiFields: {
            description,
            seeItNowPrompt,
            fields,
            placementRulesFields,
        },
    };
}
