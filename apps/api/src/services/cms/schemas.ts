/**
 * zod request schemas for the admin CMS routes (routes/admin-cms.ts).
 *
 * Messages are full sentences because the SPA shows `error` verbatim
 * (see middleware/validate.ts). Unknown keys are stripped. Free text is
 * trimmed and length-capped; every URL must be https.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Offer, OfferReward, OfferSchedule, OfferScope, OfferStatus, StorefrontContent } from '@restropulse/shared';
import { MENU_ITEM_AVAILABILITIES, OFFER_STATUSES, WEEKDAYS, isValidHhMm, normaliseOfferCode } from '@restropulse/shared';

const text = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters.`);
const name = (what: string, max = 120) =>
    z.string({ required_error: `${what} is required.`, invalid_type_error: `${what} is required.` })
        .trim()
        .min(1, `${what} is required.`)
        .max(max, `${what} must be under ${max} characters.`);
const price = (what = 'Price') =>
    z.coerce.number({ invalid_type_error: `${what} must be a number.` })
        .finite(`${what} must be a number.`)
        .min(0, `${what} can't be negative.`)
        .max(1_000_000, `${what} looks too high.`);
const httpsUrl = z.string().trim().max(2048).regex(/^https:\/\/\S+$/i, 'Links and images must start with https://');
const hhmm = z.string().refine(isValidHhMm, 'Times must look like 09:30 (24-hour).');
const id = z.string().trim().min(1).max(64);

// ----- Menu -----

const option = z.object({
    id: z.string().trim().max(64).optional(),
    name: name('Option name', 80),
    price: price('Option price'),
});

/** Give every variant/addon a stable id (new ones get a random UUID). */
const options = z.array(option).max(30, 'Up to 30 options per item.')
    .transform((rows) => rows.map((r) => ({ id: r.id || randomUUID(), name: r.name, price: r.price })));

const availability = z.enum(MENU_ITEM_AVAILABILITIES as [string, ...string[]], {
    errorMap: () => ({ message: `Availability must be one of: ${MENU_ITEM_AVAILABILITIES.join(', ')}.` }),
}) as unknown as z.ZodType<(typeof MENU_ITEM_AVAILABILITIES)[number]>;

export const CategoryCreateBody = z.object({
    name: name('Category name', 80),
    description: text(300).optional(),
    sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
});

export const CategoryUpdateBody = CategoryCreateBody.partial().refine(
    (b) => Object.keys(b).length > 0,
    'Nothing to update.',
);

const itemFields = {
    categoryId: id,
    name: name('Item name'),
    description: text(500).optional(),
    price: price(),
    images: z.array(httpsUrl).max(10, 'Up to 10 images per item.'),
    isVeg: z.boolean(),
    isBestSeller: z.boolean().optional(),
    variants: options,
    addons: options,
    availability,
    sortOrder: z.coerce.number().int().min(0).max(10_000),
};

export const ItemCreateBody = z.object({
    ...itemFields,
    images: itemFields.images.default([]),
    isVeg: itemFields.isVeg.default(false),
    variants: itemFields.variants.default([]),
    addons: itemFields.addons.default([]),
    availability: (itemFields.availability as z.ZodTypeAny).default('in_stock') as typeof itemFields.availability,
    sortOrder: itemFields.sortOrder.default(0),
});

export const ItemUpdateBody = z.object(itemFields).partial().refine(
    (b) => Object.keys(b).length > 0,
    'Nothing to update.',
);

export const AvailabilityBody = z.object({ availability });

export const ReorderBody = z.object({
    orderedIds: z.array(id, { required_error: 'orderedIds must be a list of ids.', invalid_type_error: 'orderedIds must be a list of ids.' })
        .max(2000)
        .refine((ids) => new Set(ids).size === ids.length, 'orderedIds has duplicates.'),
});

// ----- Offers -----

const reward = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('percent_off'),
        percent: z.coerce.number().gt(0, 'Percent must be more than 0.').max(100, 'Percent can be at most 100.'),
        maxDiscount: price('Maximum discount').optional(),
    }),
    z.object({ kind: z.literal('flat_off'), amount: price('Discount amount').refine((n) => n > 0, 'Discount amount must be more than 0.') }),
    z.object({ kind: z.literal('free_delivery') }),
], { errorMap: () => ({ message: 'Choose what the offer gives: percent off, flat off or free delivery.' }) });

const scope = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('all') }),
    z.object({ kind: z.literal('categories'), categoryIds: z.array(id).min(1, 'Pick at least one category.').max(100) }),
    z.object({ kind: z.literal('items'), itemIds: z.array(id).min(1, 'Pick at least one item.').max(500) }),
], { errorMap: () => ({ message: 'Choose what the offer applies to: everything, some categories or some items.' }) });

const isoDate = z.string().trim().refine((s) => Number.isFinite(Date.parse(s)), 'Dates must be valid (ISO 8601).')
    .transform((s) => new Date(s).toISOString());

const schedule = z.object({
    startsAt: isoDate.optional(),
    /** null clears the end date on update. */
    endsAt: isoDate.nullable().optional(),
    days: z.array(z.enum(WEEKDAYS as [string, ...string[]])).max(7)
        .transform((d) => [...new Set(d)])
        .optional(),
    /** null (both) clears the daily window on update. */
    from: hhmm.nullable().optional(),
    to: hhmm.nullable().optional(),
})
    .refine((s) => (s.from == null) === (s.to == null), 'Give both a start and an end time, or neither.')
    .refine((s) => !s.startsAt || !s.endsAt || Date.parse(s.endsAt) > Date.parse(s.startsAt), 'The end date must be after the start date.');

const code = z.string().trim().max(24, 'Codes are at most 24 characters.')
    .regex(/^[A-Za-z0-9_-]*$/, 'Codes can use letters, numbers, - and _ only.');

const offerFields = {
    title: name('Offer title', 80),
    description: text(300).optional(),
    reward,
    scope,
    minOrderValue: price('Minimum order').optional(),
    code: code.optional(),
    schedule,
    bannerImage: httpsUrl.optional(),
    showOnSite: z.boolean(),
    promoteInContent: z.boolean(),
    status: z.enum(OFFER_STATUSES as [string, ...string[]]),
};

export const OfferCreateBody = z.object({
    ...offerFields,
    scope: offerFields.scope.default({ kind: 'all' }),
    schedule: offerFields.schedule.default({}),
    showOnSite: offerFields.showOnSite.default(true),
    promoteInContent: offerFields.promoteInContent.default(true),
    status: offerFields.status.default('draft'),
});

/** `null` clears an optional field (code, description, minOrderValue, bannerImage). */
export const OfferUpdateBody = z.object({
    ...offerFields,
    description: offerFields.description.nullable(),
    minOrderValue: offerFields.minOrderValue.nullable(),
    code: offerFields.code.nullable(),
    bannerImage: offerFields.bannerImage.nullable(),
}).partial().refine((b) => Object.keys(b).length > 0, 'Nothing to update.');

export type OfferInputShape = Omit<Offer, 'id' | 'restaurantId' | 'createdAt' | 'updatedAt'>;

type OfferBody = z.infer<typeof OfferCreateBody> | z.infer<typeof OfferUpdateBody>;

/**
 * Turn a validated create/update body into stored fields. On update, fields
 * sent as null become `undefined` (the db layer unsets them) and a partial
 * schedule is merged onto the existing one.
 */
export function toOfferInput(body: OfferBody, existing?: Offer): Partial<OfferInputShape> {
    const out: Partial<OfferInputShape> = {};
    const b = body as Record<string, unknown>;
    if (b.title !== undefined) out.title = b.title as string;
    if ('description' in b) out.description = (b.description ?? undefined) as string | undefined;
    if (b.reward !== undefined) out.reward = b.reward as OfferReward;
    if (b.scope !== undefined) out.scope = b.scope as OfferScope;
    if ('minOrderValue' in b) out.minOrderValue = (b.minOrderValue ?? undefined) as number | undefined;
    if ('code' in b) out.code = normaliseOfferCode(b.code as string | null | undefined);
    if ('bannerImage' in b) out.bannerImage = (b.bannerImage ?? undefined) as string | undefined;
    if (b.showOnSite !== undefined) out.showOnSite = b.showOnSite as boolean;
    if (b.promoteInContent !== undefined) out.promoteInContent = b.promoteInContent as boolean;
    if (b.status !== undefined) out.status = b.status as OfferStatus;
    if (b.schedule !== undefined) {
        const incoming = b.schedule as Record<string, unknown>;
        const merged = {
            ...(existing?.schedule ?? {}),
            ...Object.fromEntries(Object.entries(incoming).filter(([, v]) => v !== undefined)),
            startsAt: (incoming.startsAt as string | undefined) ?? existing?.schedule.startsAt ?? new Date().toISOString(),
        } as OfferSchedule & Record<string, unknown>;
        // null means "clear this part of the schedule".
        for (const key of ['endsAt', 'from', 'to'] as const) {
            if (merged[key] === null) delete merged[key];
        }
        if (merged.endsAt && Date.parse(merged.endsAt) <= Date.parse(merged.startsAt)) {
            throw new OfferScheduleError('The end date must be after the start date.');
        }
        out.schedule = merged;
    }
    if (!existing) {
        // Create: drop keys that ended up undefined so the stored doc stays clean.
        for (const key of Object.keys(out) as Array<keyof OfferInputShape>) {
            if (out[key] === undefined) delete out[key];
        }
    }
    return out;
}

export class OfferScheduleError extends Error {}

export const OfferPreviewBody = z.object({
    lines: z.array(z.object({ menuItemId: id, qty: z.coerce.number().int().min(1).max(100) })).min(1, 'Add at least one item.').max(50),
    deliveryFee: price('Delivery fee').default(0),
    at: isoDate.optional(),
});

// ----- Site content -----

const hoursEntry = z.object({
    day: z.enum(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']),
    open: hhmm,
    close: hhmm,
    closed: z.boolean().optional(),
});

const hexColor = z.string().trim().regex(/^#[0-9a-f]{6}$/i, 'Colours must be hex like #6B4EFF.');

const pageSlug = z.string().trim().toLowerCase().min(1).max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Page URLs can use lowercase letters, numbers and single hyphens.');

/** Reserved by the sites host (milestone 3) for its own routes. */
const RESERVED_PAGE_SLUGS = new Set(['menu', 'order', 'cart', 'checkout', 'track', 'account', 'login', 'offers', 'gallery', 'reserve', 'api', 'sitemap', 'robots']);

export const ContentBody: z.ZodType<StorefrontContent, z.ZodTypeDef, unknown> = z.object({
    heroImages: z.array(httpsUrl).max(10, 'Up to 10 hero images.').default([]),
    videoUrl: httpsUrl.optional(),
    tagline: text(140).optional(),
    announcement: z.object({ text: text(200), enabled: z.boolean() }).optional(),
    about: text(4000).optional(),
    hours: z.array(hoursEntry).max(7).optional(),
    contact: z.object({
        phone: z.string().trim().max(20).regex(/^[+\d][\d\s-]*$/, 'Phone numbers can use digits, spaces, - and a leading +.').optional(),
        email: z.string().trim().email('Enter a valid email.').max(254).optional(),
        address: text(300).optional(),
    }).optional(),
    socialLinks: z.object({
        instagram: httpsUrl.optional(),
        facebook: httpsUrl.optional(),
        x: httpsUrl.optional(),
        youtube: httpsUrl.optional(),
    }).optional(),
    story: z.array(z.object({ year: text(10), title: name('Story title', 80), text: text(1000), image: httpsUrl.optional() })).max(20).optional(),
    chefs: z.array(z.object({ name: name('Chef name', 80), title: text(80).optional(), bio: text(1000), photo: httpsUrl.optional() })).max(10).optional(),
    gallery: z.array(z.union([
        httpsUrl.transform((url) => ({ url })),
        z.object({ url: httpsUrl, caption: text(140).optional() }),
    ])).max(60, 'Up to 60 gallery images.').optional(),
    dineIn: z.array(z.object({ title: name('Block title', 80), text: text(1000), image: httpsUrl.optional() })).max(10).optional(),
    reservations: z.object({
        daysAhead: z.coerce.number().int().min(1).max(90),
        slotMinutes: z.coerce.number().int().refine((n) => [15, 30, 60].includes(n), 'Slots must be 15, 30 or 60 minutes.'),
        maxPartySize: z.coerce.number().int().min(1).max(50),
        startTime: hhmm,
        endTime: hhmm,
    }).optional(),
    theme: z.object({
        primaryColor: hexColor.optional(),
        secondaryColor: hexColor.optional(),
        accentColor: hexColor.optional(),
        logoUrl: httpsUrl.optional(),
    }).optional(),
    pages: z.array(z.object({
        slug: pageSlug.refine((s) => !RESERVED_PAGE_SLUGS.has(s), 'That page URL is reserved. Pick another.'),
        title: name('Page title', 80),
        body: text(20_000),
        visible: z.boolean().default(true),
    })).max(20, 'Up to 20 pages.')
        .refine((pages) => new Set(pages.map((p) => p.slug)).size === pages.length, 'Two pages share the same URL.')
        .optional(),
    seo: z.object({ title: text(70).optional(), description: text(160).optional() }).optional(),
}) as unknown as z.ZodType<StorefrontContent, z.ZodTypeDef, unknown>;

export const RollbackBody = z.object({
    version: z.coerce.number({ invalid_type_error: 'Pick a version to restore.' }).int().min(1, 'Pick a version to restore.'),
});
