/**
 * Request schemas for the storefront, admin-orders and settings routes (Phase 2, M2).
 * Messages are full sentences: the storefront and dashboard show `error` verbatim.
 */

import { z } from 'zod';
import { ORDER_STATUSES, ORDER_TYPES, isValidRestaurantSlug } from '@restropulse/shared';
import { optionalText, requiredText } from '../../middleware/validate.js';

const id = z.string().trim().min(1).max(64);

export const CartLine = z.object({
    menuItemId: id,
    qty: z.number({ invalid_type_error: 'Quantities must be numbers.' }).int('Quantities must be whole numbers.'),
    variantId: id.optional(),
    addonIds: z.array(id).max(20).optional(),
});

export const QuoteBody = z.object({
    orderType: z.enum(ORDER_TYPES as [string, ...string[]], { errorMap: () => ({ message: 'Choose delivery, pickup or dine-in.' }) }),
    items: z.array(CartLine, { required_error: 'Add at least one item.' }).min(1, 'Add at least one item.').max(50, 'An order can have at most 50 lines.'),
    offerCode: optionalText(32),
});

// Indian mobile numbers, with or without +91 / 0; spaces and dashes ignored.
const phone = z
    .string({ required_error: 'Add a phone number.', invalid_type_error: 'Add a phone number.' })
    .transform((v) => v.replace(/[\s-]/g, ''))
    .refine((v) => /^(?:\+?91|0)?[6-9]\d{9}$/.test(v), 'Enter a 10-digit mobile number.')
    .transform((v) => `+91${v.slice(-10)}`);

export const AddressBody = z.object({
    line1: requiredText(200, 'Add the street address.'),
    line2: optionalText(200),
    city: optionalText(80),
    pincode: z.preprocess((v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined),
        z.string().regex(/^\d{6}$/, 'Enter a 6-digit pincode.').optional()),
    landmark: optionalText(120),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
});

export const CheckoutBody = QuoteBody.extend({
    // Orders are paid in cash at the counter, at the table or on delivery.
    paymentMethod: z.literal('cash', { errorMap: () => ({ message: 'Orders are paid in cash.' }) }).optional(),
    customerName: requiredText(80, 'Add your name.'),
    customerPhone: phone,
    address: AddressBody.optional(),
    table: optionalText(16),
    notes: optionalText(300),
});

export const TokenBody = z.object({ token: z.string().min(1).max(64) });

/** Idempotency-Key header: 8-100 visible ASCII characters. */
export function readIdempotencyKey(value: unknown): string | undefined | null {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !/^[\x21-\x7e]{8,100}$/.test(value)) return null;
    return value;
}

// ----- Admin -----

export const StatusBody = z.object({
    to: z.enum(ORDER_STATUSES as [string, ...string[]], { errorMap: () => ({ message: 'Pick a valid status.' }) }),
    note: optionalText(200),
});

export const CancelBody = z.object({
    reason: requiredText(200, 'Say why the order is cancelled.'),
});

export const FeedQuery = z.object({
    status: z.string().optional(),
    since: z.string().datetime({ message: 'since must be an ISO timestamp.' }).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
});

const money = (label: string) => z.number({ invalid_type_error: `${label} must be a number.` }).min(0, `${label} can't be negative.`).max(100000);

export const OrderingSettingsBody = z.object({
    slug: z.string().trim().toLowerCase()
        .refine(isValidRestaurantSlug, 'Use 3 to 48 lowercase letters, numbers and single hyphens for the web address.')
        .optional(),
    ordering: z.object({
        storeOpen: z.boolean(),
        taxRatePercent: z.number().min(0, "Tax can't be negative.").max(28, 'Tax can be at most 28%.'),
        delivery: z.object({
            enabled: z.boolean(),
            flatFee: money('The delivery fee'),
            minOrder: money('The delivery minimum'),
            freeAbove: money('The free-delivery threshold').nullish().transform((v) => v ?? undefined),
        }),
        pickup: z.object({ enabled: z.boolean() }),
        dineIn: z.object({ enabled: z.boolean() }),
    }),
});
