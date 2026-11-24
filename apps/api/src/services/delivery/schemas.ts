import { z } from 'zod';
import { DELIVERY_PROVIDER_IDS, DELIVERY_STRATEGIES } from '@restropulse/shared';

export const DeliverySettingsBody = z.object({
    dispatchEnabled: z.boolean(),
    dispatchAt: z.enum(['READY', 'PREPARING']),
    strategy: z.enum(DELIVERY_STRATEGIES as [string, ...string[]]),
    providers: z.array(z.enum(DELIVERY_PROVIDER_IDS as [string, ...string[]])).min(1).max(DELIVERY_PROVIDER_IDS.length),
});

/** What the restaurant can mark on a shipment run by its own riders. */
export const OWN_RIDER_STATUSES = ['RIDER_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'FAILED'] as const;

export const OwnRiderStatusBody = z.object({
    status: z.enum(OWN_RIDER_STATUSES),
    riderName: z.string().trim().min(1).max(80).optional(),
    riderPhone: z.string().trim().regex(/^\+?[0-9 ]{6,16}$/, 'Enter a phone number').optional(),
});

export const CancelShipmentBody = z.object({
    reason: z.string().trim().min(3).max(200),
});
