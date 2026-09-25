/**
 * Browser-side telemetry exports.
 *
 * Import from '@restropulse/telemetry/browser' in the React SPA.
 */

// SDK lifecycle
export { initBrowserTelemetry, getAppInsights } from './sdk.js';

// Error reporting
export { reportError } from './error-boundary.js';

// Event and metric tracking
export { trackPageView, trackEvent, trackMetric, browserEvents } from './events.js';
