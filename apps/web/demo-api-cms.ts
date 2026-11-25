/**
 * demo-api-cms.ts — DEMO twin for the Website CMS client (cmsAPI in api.ts).
 *
 * Serves the Website screens (menu, offers, site content) from an in-memory
 * [SAMPLE] catalog so the demo build needs no backend. Typed against api.ts
 * via `typeof realCmsAPI`, so the compiler keeps both surfaces identical.
 */
import type {
    MenuCategory, OrderingMenuItem, MenuItemAvailability, Offer, OfferSchedule, StorefrontContent, StorefrontVersionEntry,
} from '@restropulse/shared';
import { describeOffer, isOfferLive, normaliseOfferCode, publishStorefrontDraft, rollbackStorefront } from '@restropulse/shared';
import type { CmsItemInput, CmsOfferInput, CmsOffer, CmsImportResult, CmsContentState, CmsPublishResult } from './api';
import { notifyDemoBackendAction } from './lib/demo';
import { buildMenu, demoProfile, perRestaurant, type DemoRestaurantProfile } from './lib/demo-restaurants';

const RID = 'demo-r1';
const delay = (ms = 120): Promise<void> => new Promise((r) => setTimeout(r, ms));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
let seq = 100;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

interface DemoState {
    categories: MenuCategory[];
    items: OrderingMenuItem[];
    offers: Offer[];
    draft: StorefrontContent;
    published?: StorefrontContent;
    publishedVersion?: number;
    publishedAt?: string;
    versions: StorefrontVersionEntry[];
}

function seed(id: string): DemoState {
    if (id !== RID) return seedFromProfile(demoProfile(id));
    const categories: MenuCategory[] = [
        { id: 'demo-cat-1', restaurantId: RID, name: '[SAMPLE] Starters', sortOrder: 1 },
        { id: 'demo-cat-2', restaurantId: RID, name: '[SAMPLE] Mains', sortOrder: 2 },
        { id: 'demo-cat-3', restaurantId: RID, name: '[SAMPLE] Desserts', sortOrder: 3 },
    ];
    const item = (id: string, categoryId: string, name: string, price: number, isVeg: boolean, sortOrder: number,
        extra: Partial<OrderingMenuItem> = {}): OrderingMenuItem =>
        ({ id, restaurantId: RID, categoryId, name, price, isVeg, sortOrder, availability: 'in_stock', images: [], variants: [], addons: [], ...extra });
    const items = [
        item('demo-item-1', 'demo-cat-1', 'Paneer Tikka', 280, true, 1, { isBestSeller: true, description: 'Charred cottage cheese, mint chutney' }),
        item('demo-item-2', 'demo-cat-1', 'Chicken 65', 320, false, 2),
        item('demo-item-3', 'demo-cat-2', 'Hyderabadi Dum Biryani', 420, false, 1, {
            isBestSeller: true, variants: [{ id: 'v1', name: 'Half', price: 260 }, { id: 'v2', name: 'Full', price: 420 }],
        }),
        item('demo-item-4', 'demo-cat-2', 'Dal Makhani', 260, true, 2, { addons: [{ id: 'a1', name: 'Butter naan', price: 60 }] }),
        item('demo-item-5', 'demo-cat-3', 'Double Ka Meetha', 180, true, 1, { availability: 'out_of_stock' }),
    ];
    const offers: Offer[] = [
        {
            id: 'demo-offer-1', restaurantId: RID, title: '[SAMPLE] Weekday lunch',
            reward: { kind: 'percent_off', percent: 15, maxDiscount: 150 }, scope: { kind: 'all' }, minOrderValue: 500,
            code: 'LUNCH15', schedule: { startsAt: '2026-11-01T00:00:00.000Z', days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '12:00', to: '15:00' },
            showOnSite: true, promoteInContent: true, status: 'active',
        },
        {
            id: 'demo-offer-2', restaurantId: RID, title: '[SAMPLE] Free delivery weekend',
            reward: { kind: 'free_delivery' }, scope: { kind: 'all' },
            schedule: { startsAt: '2026-12-01T00:00:00.000Z', days: ['sat', 'sun'] },
            showOnSite: true, promoteInContent: false, status: 'draft',
        },
    ];
    const draft: StorefrontContent = {
        heroImages: [],
        tagline: '[SAMPLE] Slow-cooked biryani since 1998',
        announcement: { text: '[SAMPLE] Now open for Sunday brunch', enabled: true },
        about: '[SAMPLE] A family kitchen in the old city, cooking the recipes our grandmother wrote down.',
        hours: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
            .map((day) => ({ day, open: '11:00', close: '23:00' })),
        contact: { phone: '+91 00000 00000' },
        pages: [{ slug: 'catering', title: '[SAMPLE] Catering', body: '[SAMPLE] We cater weddings and office lunches.', visible: true }],
        seo: { title: '[SAMPLE] Demo Kitchen', description: '[SAMPLE] Biryani and kebabs, delivered.' },
    };
    const first = publishStorefrontDraft({ draft, versions: [] }, new Date('2026-11-01T09:00:00Z'));
    return { categories, items, offers, draft: clone(draft), ...first };
}

function seedFromProfile(p: DemoRestaurantProfile): DemoState {
    const { categories, items } = buildMenu(p);
    const draft = clone(p.content);
    if (!p.contentPublished) return { categories, items, offers: clone(p.offers), draft, versions: [] };
    const first = publishStorefrontDraft({ draft, versions: [] }, new Date('2026-11-01T09:00:00Z'));
    return { categories, items, offers: clone(p.offers), draft: clone(draft), ...first };
}

// One catalog per sample restaurant; the signed-in one is served.
const store = perRestaurant(seed);
const S = store.get;

/** Test hook: restore the sample catalog. */
export function resetDemoCms(): void {
    store.reset();
}

const withSummary = (offer: Offer): CmsOffer => ({ ...clone(offer), summary: describeOffer(offer), live: isOfferLive(offer) });
const notFound = (what: string) => new Error(`${what} not found`);

/** Mirrors the API: undefined keeps a schedule part, null clears it. */
function mergeSchedule(base: OfferSchedule, patch: CmsOfferInput['schedule'] = {}): OfferSchedule {
    const merged: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete merged[key];
        else if (value !== undefined) merged[key] = value;
    }
    return merged as unknown as OfferSchedule;
}

export const cmsAPI = {
    getCategories: async (): Promise<MenuCategory[]> => {
        await delay();
        return clone([...S().categories].sort((a, b) => a.sortOrder - b.sortOrder));
    },
    createCategory: async (input: { name: string; description?: string }): Promise<MenuCategory> => {
        await delay();
        notifyDemoBackendAction();
        const category: MenuCategory = { id: nextId('demo-cat'), restaurantId: RID, ...input, sortOrder: S().categories.length + 1 };
        S().categories.push(category);
        return clone(category);
    },
    updateCategory: async (id: string, input: { name?: string; description?: string }): Promise<MenuCategory> => {
        await delay();
        notifyDemoBackendAction();
        const category = S().categories.find((c) => c.id === id);
        if (!category) throw notFound('Category');
        Object.assign(category, input);
        return clone(category);
    },
    deleteCategory: async (id: string): Promise<void> => {
        await delay();
        if (S().items.some((i) => i.categoryId === id)) throw new Error('Move or delete the items in this category first.');
        notifyDemoBackendAction();
        S().categories = S().categories.filter((c) => c.id !== id);
    },
    reorderCategories: async (orderedIds: string[]): Promise<MenuCategory[]> => {
        await delay();
        notifyDemoBackendAction();
        orderedIds.forEach((id, i) => {
            const c = S().categories.find((x) => x.id === id);
            if (c) c.sortOrder = i + 1;
        });
        return cmsAPI.getCategories();
    },

    getItems: async (): Promise<OrderingMenuItem[]> => {
        await delay();
        return clone(S().items);
    },
    createItem: async (input: CmsItemInput): Promise<OrderingMenuItem> => {
        await delay();
        if (S().items.some((i) => i.name === input.name)) throw new Error(`An item called "${input.name}" already exists.`);
        notifyDemoBackendAction();
        const item: OrderingMenuItem = {
            id: nextId('demo-item'), restaurantId: RID, isVeg: false, availability: 'in_stock', sortOrder: 0, images: [],
            ...input,
            variants: (input.variants ?? []).map((v) => ({ ...v, id: v.id ?? nextId('v') })),
            addons: (input.addons ?? []).map((a) => ({ ...a, id: a.id ?? nextId('a') })),
        };
        S().items.push(item);
        return clone(item);
    },
    updateItem: async (id: string, input: Partial<CmsItemInput>): Promise<OrderingMenuItem> => {
        await delay();
        const item = S().items.find((i) => i.id === id);
        if (!item) throw notFound('Menu item');
        notifyDemoBackendAction();
        const { variants, addons, ...rest } = input;
        Object.assign(item, rest);
        if (variants) item.variants = variants.map((v) => ({ ...v, id: v.id ?? nextId('v') }));
        if (addons) item.addons = addons.map((a) => ({ ...a, id: a.id ?? nextId('a') }));
        return clone(item);
    },
    setAvailability: async (id: string, availability: MenuItemAvailability): Promise<OrderingMenuItem> => {
        return cmsAPI.updateItem(id, { availability });
    },
    deleteItem: async (id: string): Promise<void> => {
        await delay();
        notifyDemoBackendAction();
        S().items = S().items.filter((i) => i.id !== id);
    },
    importCsv: async (csv: string): Promise<CmsImportResult> => {
        await delay(300);
        notifyDemoBackendAction();
        // The demo only reads simple unquoted rows; the real API does full CSV.
        const [header, ...rows] = csv.trim().split(/\r?\n/);
        const cols = (header ?? '').split(',').map((c) => c.trim().toLowerCase());
        const at = (name: string) => cols.indexOf(name);
        if (at('category') < 0 || at('name') < 0 || at('price') < 0) {
            throw new Error('CSV needs category, name and price columns.');
        }
        const result: CmsImportResult = { created: 0, updated: 0, failed: 0, errors: [] };
        rows.forEach((line, index) => {
            const cells = line.split(',').map((c) => c.trim());
            const name = cells[at('name')];
            const price = Number(cells[at('price')]);
            const categoryName = cells[at('category')];
            if (!name || !categoryName || !Number.isFinite(price) || price < 0) {
                result.failed++;
                result.errors.push({ row: index + 2, message: 'Needs a category, a name and a price.' });
                return;
            }
            let category = S().categories.find((c) => c.name.toLowerCase() === categoryName.toLowerCase());
            if (!category) {
                category = { id: nextId('demo-cat'), restaurantId: RID, name: categoryName, sortOrder: S().categories.length + 1 };
                S().categories.push(category);
            }
            const existing = S().items.find((i) => i.name === name);
            if (existing) {
                Object.assign(existing, { price, categoryId: category.id });
                result.updated++;
            } else {
                S().items.push({
                    id: nextId('demo-item'), restaurantId: RID, categoryId: category.id, name, price, isVeg: false,
                    availability: 'in_stock', sortOrder: 0, images: [], variants: [], addons: [],
                });
                result.created++;
            }
        });
        return result;
    },

    getOffers: async (includeArchived = false): Promise<CmsOffer[]> => {
        await delay();
        return S().offers.filter((o) => includeArchived || o.status !== 'archived').map(withSummary);
    },
    createOffer: async (input: CmsOfferInput): Promise<CmsOffer> => {
        await delay();
        notifyDemoBackendAction();
        const offer: Offer = {
            id: nextId('demo-offer'), restaurantId: RID,
            title: input.title,
            ...(input.description ? { description: input.description } : {}),
            reward: input.reward,
            scope: input.scope ?? { kind: 'all' },
            ...(input.minOrderValue ? { minOrderValue: input.minOrderValue } : {}),
            ...(normaliseOfferCode(input.code) ? { code: normaliseOfferCode(input.code) } : {}),
            schedule: mergeSchedule({ startsAt: new Date().toISOString() }, input.schedule),
            showOnSite: input.showOnSite ?? true,
            promoteInContent: input.promoteInContent ?? true,
            status: input.status ?? 'draft',
        };
        S().offers.push(offer);
        return withSummary(offer);
    },
    updateOffer: async (id: string, input: Partial<CmsOfferInput>): Promise<CmsOffer> => {
        await delay();
        const offer = S().offers.find((o) => o.id === id);
        if (!offer) throw notFound('Offer');
        notifyDemoBackendAction();
        const { schedule, code, description, minOrderValue, bannerImage, ...rest } = input;
        Object.assign(offer, rest);
        if (schedule) offer.schedule = mergeSchedule(offer.schedule, schedule);
        if (code !== undefined) offer.code = normaliseOfferCode(code);
        if (description !== undefined) offer.description = description ?? undefined;
        if (minOrderValue !== undefined) offer.minOrderValue = minOrderValue ?? undefined;
        if (bannerImage !== undefined) offer.bannerImage = bannerImage ?? undefined;
        return withSummary(offer);
    },
    deleteOffer: async (id: string): Promise<void> => {
        await delay();
        notifyDemoBackendAction();
        S().offers = S().offers.filter((o) => o.id !== id);
    },

    getContent: async (): Promise<CmsContentState> => {
        await delay();
        return {
            draft: clone(S().draft),
            published: S().published ? clone(S().published!) : null,
            publishedVersion: S().publishedVersion ?? null,
            publishedAt: S().publishedAt ?? null,
            versions: S().versions.map(({ version, publishedAt }) => ({ version, publishedAt })),
        };
    },
    saveDraft: async (draft: StorefrontContent): Promise<StorefrontContent> => {
        await delay();
        notifyDemoBackendAction();
        S().draft = clone(draft);
        return clone(S().draft);
    },
    publish: async (): Promise<CmsPublishResult> => {
        await delay();
        notifyDemoBackendAction();
        const result = publishStorefrontDraft(S());
        Object.assign(S(), result);
        return { publishedVersion: result.publishedVersion, publishedAt: result.publishedAt };
    },
    rollback: async (version: number): Promise<CmsPublishResult> => {
        await delay();
        const result = rollbackStorefront(S(), version);
        if (!result) throw notFound('That version');
        notifyDemoBackendAction();
        Object.assign(S(), result);
        return { publishedVersion: result.publishedVersion, publishedAt: result.publishedAt, restoredFrom: version };
    },
};
