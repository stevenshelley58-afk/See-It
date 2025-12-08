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
            label: "Unprepared",
            explanation: "Product has not been prepared yet",
            buttonLabel: "Prepare",
            buttonDisabled: false,
            showSpinner: false,
        };
    }

    switch (status) {
        case "pending":
            return {
                tone: "attention",
                label: "Pending",
                explanation: "Queued for preparation...",
                buttonLabel: "Preparing...",
                buttonDisabled: true,
                showSpinner: true,
            };

        case "processing":
            return {
                tone: "attention",
                label: "Processing",
                explanation: "Currently being processed...",
                buttonLabel: "Processing...",
                buttonDisabled: true,
                showSpinner: true,
            };

        case "ready":
            return {
                tone: "success",
                label: "Ready",
                explanation: null,
                buttonLabel: "Reprepare",
                buttonDisabled: false,
                showSpinner: false,
            };

        case "failed":
            return {
                tone: "critical",
                label: "Failed",
                explanation: "Preparation failed. Click Retry to try again.",
                buttonLabel: "Retry",
                buttonDisabled: false,
                showSpinner: false,
            };

        case "stale":
            return {
                tone: "warning",
                label: "Stale",
                explanation: "Product image has changed. Regenerate to update.",
                buttonLabel: "Regenerate",
                buttonDisabled: false,
                showSpinner: false,
            };

        case "orphaned":
            return {
                tone: "info",
                label: "Orphaned",
                explanation: "Source image no longer exists",
                buttonLabel: "Reprepare",
                buttonDisabled: false,
                showSpinner: false,
            };

        default:
            return {
                tone: "new",
                label: String(status),
                explanation: null,
                buttonLabel: "Prepare",
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

