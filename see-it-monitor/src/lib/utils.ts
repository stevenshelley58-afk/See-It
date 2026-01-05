/**
 * Utility functions for Session Monitor
 */

import type { StepName, SessionStatus } from './types';

/**
 * Format duration in milliseconds to human readable string
 */
export function formatDuration(ms: number | undefined): string {
    if (!ms) return '-';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes > 0) {
        return `${minutes}m ${remainingSeconds}s`;
    }
    return `${seconds}s`;
}

/**
 * Format relative time (e.g., "2 minutes ago")
 */
export function formatTimeAgo(dateInput: string | Date | null | undefined): string {
    if (!dateInput) return '';
    const date = new Date(dateInput);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSeconds < 60) return 'just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
}

/**
 * Get step label for display
 */
export function getStepLabel(step: StepName): string {
    const labels: Record<StepName | string, string> = {
        room: 'Room',
        mask: 'Mask',
        inpaint: 'Inpaint',
        placement: 'Placement',
        final: 'Final',
        room_capture: 'Room',
    };
    return labels[step] || step;
}

/**
 * Get step number (1-5)
 */
export function getStepNumber(step: StepName): number {
    const order: string[] = ['room', 'room_capture', 'mask', 'inpaint', 'placement', 'final'];
    return order.indexOf(step) + 1;
}

/**
 * Get status color classes
 */
export function getStatusColor(status: string): { bg: string; text: string; dot: string } {
    switch (status) {
        case 'complete':
        case 'completed':
            return { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' };
        case 'failed':
        case 'error':
            return { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' };
        case 'abandoned':
            return { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' };
        default:
            return { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' };
    }
}

/**
 * Truncate shop domain for display
 */
export function truncateShop(shop: string): string {
    if (!shop) return '';
    return shop.replace('.myshopify.com', '');
}

/**
 * Format date for display
 */
export function formatDate(dateInput: string | Date | null | undefined): string {
    if (!dateInput) return '';
    const date = new Date(dateInput);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}
