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
        renderInstructions: description || null,
        renderInstructionsSeeItNow: seeItNowPrompt,
        renderInstructionsSeeItNowDirty: seeItNowDirty,
        placementFields: {
            surface: fields.surface,
            material: fields.material,
            orientation: fields.orientation,
            shadow: fields.shadow,
            dimensions: fields.dimensions || { height: null, width: null },
            additionalNotes: fields.additionalNotes || '',
        },
        placementRulesConfig: {
            sceneRole: placementRulesFields.sceneRole || null,
            replacementRule: placementRulesFields.replacementRule || null,
            allowSpaceCreation: placementRulesFields.allowSpaceCreation !== undefined ? placementRulesFields.allowSpaceCreation : null,
        },
        merchantOverrides: merchantOverrides,
        merchantOverridesDirty: merchantOverridesDirty,
        enabled: enabledDirty ? enabled : undefined,
        dirty: !!merchantOverridesDirty || !!seeItNowDirty || !!hasEdited || enabledDirty,
    };
}

