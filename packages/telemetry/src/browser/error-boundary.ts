/**
 * Error reporting helper for React ErrorBoundary integration.
 *
 * Called from ErrorBoundary.componentDidCatch to report crashes
 * to Application Insights. Flushes immediately since a crash
 * may prevent normal batch sending.
 */

import { getAppInsights } from './sdk.js';

/**
 * Report a React error boundary catch to Application Insights.
 * Always collected (never sampled).
 */
export function reportError(error: Error, errorInfo: { componentStack?: string }): void {
    const ai = getAppInsights();
    if (!ai) return;

    ai.trackException({
        exception: error,
        properties: {
            componentStack: errorInfo.componentStack || '',
            viewState: getCurrentViewState(),
            online: String(navigator.onLine),
            screenWidth: String(window.screen.width),
            screenHeight: String(window.screen.height),
        },
        severityLevel: 3, // Error
    });

    // Flush immediately -- the app may be in a broken state
    ai.flush();
}

function getCurrentViewState(): string {
    const params = new URLSearchParams(window.location.search);
    return params.get('view') || 'unknown';
}
