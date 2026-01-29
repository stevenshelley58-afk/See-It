/**
 * Build metadata from PlacementTab for saving.
 *
 * Includes:
 * - enabled toggle for customer visibility
 * - dimensions (height/width) -> maps to merchantOverrides.dimensions_cm
 * - material -> maps to merchantOverrides.material_profile.primary
 */
export function buildPlacementTabMetadata({
    enabled,
    originalEnabled,
    dimensions,
    originalDimensions,
    material,
    originalMaterial,
}) {
    const baselineEnabled = originalEnabled || false;
    const enabledDirty = enabled !== baselineEnabled;

    // Compare dimensions (convert to numbers for comparison)
    const currentHeight = dimensions?.height != null ? Number(dimensions.height) : null;
    const currentWidth = dimensions?.width != null ? Number(dimensions.width) : null;
    const origHeight = originalDimensions?.height != null ? Number(originalDimensions.height) : null;
    const origWidth = originalDimensions?.width != null ? Number(originalDimensions.width) : null;

    const heightDirty = currentHeight !== origHeight;
    const widthDirty = currentWidth !== origWidth;
    const dimensionsDirty = heightDirty || widthDirty;

    // Compare material
    const materialDirty = material !== (originalMaterial || null);

    return {
        enabled: enabledDirty ? enabled : undefined,
        // Use empty string to signal "clear override" (FormData friendly).
        dimensionHeight: heightDirty ? (currentHeight !== null ? currentHeight : "") : undefined,
        dimensionWidth: widthDirty ? (currentWidth !== null ? currentWidth : "") : undefined,
        material: materialDirty ? material : undefined,
        dirty: enabledDirty || dimensionsDirty || materialDirty,
    };
}
