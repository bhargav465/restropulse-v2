/**
 * Feature-entitlement logic. A restaurant may use the gated features
 * (Content Engine, Restaurant Intelligence, Strategy) when it either has an
 * active paid subscription OR is inside its no-card free-trial window.
 *
 * The actual logic lives in @restropulse/shared (getEntitlement/isEntitled)
 * so the content-engine's cycle-sync processor can reuse the exact same
 * trial/active-plan rules without a cross-app dependency on apps/api. This
 * file re-exports for backward compatibility with existing imports.
 */
export { getEntitlement, isEntitled } from '@restropulse/shared';
export type { EntitlementState } from '@restropulse/shared';
