/**
 * Build metadata from PlacementTab for saving.
 *
 * Only includes enabled toggle for customer visibility.
 */
export function buildPlacementTabMetadata({
    enabled,
    originalEnabled,
}) {
    const baselineEnabled = originalEnabled || false;
    const enabledDirty = enabled !== baselineEnabled;

    return {
        enabled: enabledDirty ? enabled : undefined,
        dirty: enabledDirty,
    };
}
