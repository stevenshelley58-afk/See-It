/**
 * Centralized status mapping for ProductAsset
 * 
 * Maps database status values to UI display states
 */

export type AssetStatus = "pending" | "processing" | "ready" | "failed" | "stale" | "orphaned" | "unprepared";

export interface StatusInfo {
    tone: "new" | "success" | "attention" | "warning" | "critical" | "info";
    label: string;
    explanation: string | null;
    buttonLabel: string;
    buttonDisabled: boolean;
    showSpinner: boolean;
}

/**
 * Get UI status info for a ProductAsset status
 */
export function getStatusInfo(status: AssetStatus | string | null | undefined): StatusInfo {
    if (!status || status === "unprepared") {
        return {
            tone: "new",
            label: "Not Processed",
            explanation: "Background has not been removed yet",
            buttonLabel: "Remove BG",
            buttonDisabled: false,
            showSpinner: false,
        };
    }

    switch (status) {
        case "pending":
            return {
                tone: "attention",
                label: "Queued",
                explanation: "Waiting in processing queue...",
                buttonLabel: "Queued...",
                buttonDisabled: true,
                showSpinner: true,
            };

        case "processing":
            return {
                tone: "attention",
                label: "Removing BG...",
                explanation: "Background removal in progress...",
                buttonLabel: "Processing...",
                buttonDisabled: true,
                showSpinner: true,
            };

        case "ready":
            return {
                tone: "success",
                label: "BG Removed",
                explanation: "Background successfully removed",
                buttonLabel: "Re-process",
                buttonDisabled: false,
                showSpinner: false,
            };

        case "failed":
            return {
                tone: "critical",
                label: "Error",
                explanation: "Background removal failed. Click Retry to try again.",
                buttonLabel: "Retry",
                buttonDisabled: false,
                showSpinner: false,
            };

        case "stale":
            return {
                tone: "warning",
                label: "Outdated",
                explanation: "Product image has changed. Re-process to update.",
                buttonLabel: "Re-process",
                buttonDisabled: false,
                showSpinner: false,
            };

        case "orphaned":
            return {
                tone: "info",
                label: "Missing Source",
                explanation: "Original image no longer exists",
                buttonLabel: "Re-process",
                buttonDisabled: false,
                showSpinner: false,
            };

        default:
            return {
                tone: "new",
                label: String(status),
                explanation: null,
                buttonLabel: "Remove BG",
                buttonDisabled: false,
                showSpinner: false,
            };
    }
}

/**
 * Format error message for display (truncate if too long)
 */
export function formatErrorMessage(errorMessage: string | null | undefined, maxLength: number = 100): string | null {
    if (!errorMessage) return null;
    if (errorMessage.length <= maxLength) return errorMessage;
    return errorMessage.substring(0, maxLength) + "...";
}





