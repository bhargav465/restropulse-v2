/**
 * Server-side analytics event emission for the ordering feature.
 * Best-effort: failures are swallowed inside insertAnalyticsEvent so
 * analytics can never break a request.
 */

import { insertAnalyticsEvent } from '@restropulse/db';

export interface EmitEventInput {
    name: string;
    restaurantId: string;
    sessionId?: string;
    customerId?: string;
    payload?: Record<string, unknown>;
}

export function emitOrderingEvent(input: EmitEventInput): void {
    void insertAnalyticsEvent({
        name: input.name,
        restaurantId: input.restaurantId,
        sessionId: input.sessionId ?? 'server',
        ...(input.customerId ? { customerId: input.customerId } : {}),
        ...(input.payload ? { payload: input.payload } : {}),
        ts: new Date(),
    });
}
