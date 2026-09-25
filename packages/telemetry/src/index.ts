/**
 * @restropulse/telemetry
 *
 * Shared exports: types and privacy utilities.
 * For server-side telemetry, import from '@restropulse/telemetry/server'.
 * For browser-side telemetry, import from '@restropulse/telemetry/browser'.
 */

export type { TelemetryConfig, BrowserTelemetryConfig, LogLevel, EventName } from './types.js';
export { EventNames } from './types.js';
export { sanitize, sanitizeString, maskPhone, hashForCorrelation, stripPIIFromUrl } from './privacy.js';
