import { describe, it, expect } from 'vitest';
import {
  projectLegacyMenu,
  embeddedMenuToCatalog,
  localClock,
  inDailyWindow,
  isValidHhMm,
  normaliseOfferCode,
  isOfferLive,
  isOfferPromotable,
  describeOffer,
  mergeActiveOffers,
  computeOfferDiscount,
  normaliseStorefrontContent,
  publishStorefrontDraft,
  rollbackStorefront,
  STOREFRONT_VERSION_HISTORY_LIMIT,
} from '../src/index.js';
import type { MenuCategory, Offer, OrderingMenuItem, StorefrontVersionEntry } from '../src/index.js';

const cat = (id: string, name: string, sortOrder: number): MenuCategory => ({ id, restaurantId: 'r1', name, sortOrder });
const item = (over: Partial<OrderingMenuItem> & Pick<OrderingMenuItem, 'id' | 'name' | 'categoryId'>): OrderingMenuItem => ({
  restaurantId: 'r1', price: 100, isVeg: true, availability: 'in_stock', sortOrder: 1, ...over,
});

// 2026-11-25 is a Wednesday. 06:30Z = 12:00 IST.
const WED_NOON_IST = new Date('2026-11-25T06:30:00Z');

const offer = (over: Partial<Offer> = {}): Offer => ({
  id: 'o1',
  restaurantId: 'r1',
  title: 'Lunch deal',
  reward: { kind: 'percent_off', percent: 20 },
  scope: { kind: 'all' },
  schedule: { startsAt: '2026-11-01T00:00:00Z' },
  showOnSite: true,
  promoteInContent: true,
  status: 'active',
  ...over,
});

describe('projectLegacyMenu', () => {
  it('orders by category then item, drops hidden, maps availability', () => {
    const categories = [cat('c2', 'Mains', 2), cat('c1', 'Starters', 1)];
    const items = [
      item({ id: 'i3', name: 'Biryani', categoryId: 'c2', sortOrder: 1, isVeg: false, description: 'Dum', isBestSeller: true }),
      item({ id: 'i2', name: 'Soup', categoryId: 'c1', sortOrder: 2, availability: 'out_of_stock' }),
      item({ id: 'i1', name: 'Paneer Tikka', categoryId: 'c1', sortOrder: 1 }),
      item({ id: 'i4', name: 'Secret', categoryId: 'c1', sortOrder: 3, availability: 'hidden' }),
    ];
    const menu = projectLegacyMenu(categories, items);
    expect(menu.map((m) => m.name)).toEqual(['Paneer Tikka', 'Soup', 'Biryani']);
    expect(menu[1]).toMatchObject({ category: 'Starters', isAvailable: false });
    expect(menu[2]).toEqual({
      id: 'i3', category: 'Mains', name: 'Biryani', price: 100, isVeg: false, isAvailable: true,
      description: 'Dum', isBestSeller: true,
    });
    expect(menu[0]).not.toHaveProperty('description');
  });

  it('puts items with a missing category last under "Other"', () => {
    const menu = projectLegacyMenu([cat('c1', 'Starters', 1)], [
      item({ id: 'a', name: 'Orphan', categoryId: 'gone' }),
      item({ id: 'b', name: 'Samosa', categoryId: 'c1' }),
    ]);
    expect(menu.map((m) => [m.name, m.category])).toEqual([['Samosa', 'Starters'], ['Orphan', 'Other']]);
  });
});

describe('embeddedMenuToCatalog', () => {
  it('builds categories in first-seen order and dedupes names', () => {
    const draft = embeddedMenuToCatalog([
      { id: '1', category: 'Starters', name: 'Samosa', isVeg: true, isAvailable: true, price: 40 },
      { id: '2', category: 'starters', name: 'Kebab', isVeg: false, isAvailable: false, isBestSeller: true, description: ' smoky ' },
      { id: '3', category: '', name: 'Lassi', isVeg: true, isAvailable: true },
      { id: '4', category: 'Starters', name: 'Samosa', isVeg: true, isAvailable: true },
      { id: '5', category: 'Starters', name: '  ', isVeg: true, isAvailable: true },
      { id: '6', category: 'Drinks', name: 'Chai', isVeg: true, isAvailable: true, price: -5 },
    ]);
    expect(draft.categories).toEqual([
      { name: 'Starters', sortOrder: 1 },
      { name: 'Other', sortOrder: 2 },
      { name: 'Drinks', sortOrder: 3 },
    ]);
    expect(draft.items).toEqual([
      { categoryName: 'Starters', name: 'Samosa', price: 40, isVeg: true, availability: 'in_stock', sortOrder: 1 },
      { categoryName: 'Starters', name: 'Kebab', price: 0, isVeg: false, availability: 'out_of_stock', sortOrder: 2, description: 'smoky', isBestSeller: true },
      { categoryName: 'Other', name: 'Lassi', price: 0, isVeg: true, availability: 'in_stock', sortOrder: 1 },
      { categoryName: 'Drinks', name: 'Chai', price: 0, isVeg: true, availability: 'in_stock', sortOrder: 1 },
    ]);
    expect(draft.duplicateNames).toEqual(['Samosa']);
  });

  it('handles an absent menu', () => {
    expect(embeddedMenuToCatalog(undefined)).toEqual({ categories: [], items: [], duplicateNames: [] });
  });
});

describe('time helpers', () => {
  it('reads the IST clock', () => {
    expect(localClock(WED_NOON_IST)).toEqual({ day: 'wed', minutes: 12 * 60 });
    expect(localClock(new Date('2026-11-25T20:00:00Z'))).toEqual({ day: 'thu', minutes: 90 });
    expect(localClock(WED_NOON_IST, 'UTC')).toEqual({ day: 'wed', minutes: 6 * 60 + 30 });
  });

  it('handles normal, wrapping and zero-length windows', () => {
    expect(inDailyWindow(12 * 60, '11:00', '15:00')).toBe(true);
    expect(inDailyWindow(15 * 60, '11:00', '15:00')).toBe(false);
    expect(inDailyWindow(23 * 60 + 30, '22:00', '02:00')).toBe(true);
    expect(inDailyWindow(60, '22:00', '02:00')).toBe(true);
    expect(inDailyWindow(12 * 60, '22:00', '02:00')).toBe(false);
    expect(inDailyWindow(5, '00:00', '00:00')).toBe(true);
  });

  it('validates HH:mm', () => {
    expect(isValidHhMm('09:30')).toBe(true);
    expect(isValidHhMm('24:00')).toBe(false);
    expect(isValidHhMm('9:30')).toBe(false);
  });

  it('normalises codes', () => {
    expect(normaliseOfferCode(' lunch15 ')).toBe('LUNCH15');
    expect(normaliseOfferCode('  ')).toBeUndefined();
    expect(normaliseOfferCode(undefined)).toBeUndefined();
  });
});

describe('isOfferLive', () => {
  it('requires active status and the date range', () => {
    expect(isOfferLive(offer(), WED_NOON_IST)).toBe(true);
    expect(isOfferLive(offer({ status: 'paused' }), WED_NOON_IST)).toBe(false);
    expect(isOfferLive(offer({ schedule: { startsAt: '2026-12-01T00:00:00Z' } }), WED_NOON_IST)).toBe(false);
    expect(isOfferLive(offer({ schedule: { startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-25T06:30:00Z' } }), WED_NOON_IST)).toBe(false);
    expect(isOfferLive(offer({ schedule: { startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-25T06:30:01Z' } }), WED_NOON_IST)).toBe(true);
  });

  it('applies weekday and daily window in restaurant time', () => {
    const weekdayLunch = offer({ schedule: { startsAt: '2026-11-01T00:00:00Z', days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '11:00', to: '15:00' } });
    expect(isOfferLive(weekdayLunch, WED_NOON_IST)).toBe(true);
    expect(isOfferLive(weekdayLunch, new Date('2026-11-28T06:30:00Z'))).toBe(false); // Saturday
    expect(isOfferLive(weekdayLunch, new Date('2026-11-25T12:00:00Z'))).toBe(false); // 17:30 IST
    expect(isOfferLive(weekdayLunch, WED_NOON_IST, 'UTC')).toBe(false); // 06:30 UTC is outside 11-15
  });
});

describe('isOfferPromotable / mergeActiveOffers', () => {
  it('ignores the daily window but honours status, flag and end date', () => {
    const evening = offer({ schedule: { startsAt: '2026-11-01T00:00:00Z', from: '19:00', to: '22:00' } });
    expect(isOfferPromotable(evening, WED_NOON_IST)).toBe(true);
    expect(isOfferPromotable(offer({ promoteInContent: false }), WED_NOON_IST)).toBe(false);
    expect(isOfferPromotable(offer({ status: 'draft' }), WED_NOON_IST)).toBe(false);
    expect(isOfferPromotable(offer({ schedule: { startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-02T00:00:00Z' } }), WED_NOON_IST)).toBe(false);
  });

  it('keeps manual offers first and dedupes', () => {
    const merged = mergeActiveOffers(
      ['Flat 15% Off on Weekday Lunch Buffets', ' '],
      [offer({ title: 'Diwali', reward: { kind: 'flat_off', amount: 100 } }), offer({ id: 'o2', status: 'paused' })],
      WED_NOON_IST,
    );
    expect(merged).toEqual(['Flat 15% Off on Weekday Lunch Buffets', 'Diwali: ₹100 off']);
    expect(mergeActiveOffers(['A', 'a '], [], WED_NOON_IST)).toEqual(['A']);
    expect(mergeActiveOffers(undefined, [], WED_NOON_IST)).toEqual([]);
  });
});

describe('describeOffer', () => {
  it('describes each reward with conditions', () => {
    expect(describeOffer(offer({
      title: 'Weekday lunch',
      reward: { kind: 'percent_off', percent: 15, maxDiscount: 150 },
      minOrderValue: 500,
      code: 'LUNCH15',
      schedule: { startsAt: 'x', days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '12:00', to: '15:00' },
    }))).toBe('Weekday lunch: 15% off (up to ₹150) on orders above ₹500, weekdays 12:00-15:00. Code LUNCH15');
    expect(describeOffer(offer({ title: 'Weekend', reward: { kind: 'free_delivery' }, schedule: { startsAt: 'x', days: ['sun', 'sat'] } })))
      .toBe('Weekend: free delivery, weekends');
    expect(describeOffer(offer({ title: 'Midweek', reward: { kind: 'flat_off', amount: 49.5 }, schedule: { startsAt: 'x', days: ['wed', 'tue'] } })))
      .toBe('Midweek: ₹49.50 off, Tue, Wed');
    expect(describeOffer(offer({ title: 'All week', schedule: { startsAt: 'x', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] } })))
      .toBe('All week: 20% off');
  });
});

describe('computeOfferDiscount', () => {
  const lines = [
    { menuItemId: 'i1', categoryId: 'c1', lineTotal: 300 },
    { menuItemId: 'i2', categoryId: 'c2', lineTotal: 200 },
  ];

  it('applies percent with a cap and scopes', () => {
    expect(computeOfferDiscount(offer(), { lines, deliveryFee: 40, now: WED_NOON_IST })).toEqual({ discount: 100, deliveryDiscount: 0 });
    expect(computeOfferDiscount(offer({ reward: { kind: 'percent_off', percent: 20, maxDiscount: 60 } }), { lines, deliveryFee: 0, now: WED_NOON_IST }).discount).toBe(60);
    expect(computeOfferDiscount(offer({ scope: { kind: 'categories', categoryIds: ['c2'] } }), { lines, deliveryFee: 0, now: WED_NOON_IST }).discount).toBe(40);
    expect(computeOfferDiscount(offer({ scope: { kind: 'items', itemIds: ['i1'] }, reward: { kind: 'percent_off', percent: 33.333 } }), { lines, deliveryFee: 0, now: WED_NOON_IST }).discount).toBe(100);
  });

  it('caps a flat discount at the eligible total', () => {
    expect(computeOfferDiscount(offer({ reward: { kind: 'flat_off', amount: 1000 }, scope: { kind: 'items', itemIds: ['i2'] } }), { lines, deliveryFee: 0, now: WED_NOON_IST }).discount).toBe(200);
  });

  it('gives free delivery', () => {
    expect(computeOfferDiscount(offer({ reward: { kind: 'free_delivery' } }), { lines, deliveryFee: 49, now: WED_NOON_IST })).toEqual({ discount: 0, deliveryDiscount: 49 });
  });

  it('explains why it gave nothing', () => {
    expect(computeOfferDiscount(offer({ status: 'paused' }), { lines, deliveryFee: 0, now: WED_NOON_IST }).reason).toBe('not_live');
    expect(computeOfferDiscount(offer({ minOrderValue: 600 }), { lines, deliveryFee: 0, now: WED_NOON_IST }).reason).toBe('below_min_order');
    expect(computeOfferDiscount(offer({ scope: { kind: 'items', itemIds: ['nope'] } }), { lines, deliveryFee: 0, now: WED_NOON_IST }).reason).toBe('no_eligible_items');
  });
});

describe('site content versioning', () => {
  it('normalises legacy gallery strings and missing hero images', () => {
    expect(normaliseStorefrontContent({ gallery: ['a.jpg', { url: 'b.jpg', caption: 'B' }, 7, null] })).toEqual({
      heroImages: [],
      gallery: [{ url: 'a.jpg' }, { url: 'b.jpg', caption: 'B' }],
    });
    expect(normaliseStorefrontContent(null)).toEqual({ heroImages: [] });
    expect(normaliseStorefrontContent({ heroImages: ['x', 3] })).toEqual({ heroImages: ['x'] });
  });

  it('publishes the next version newest-first and caps history', () => {
    const now = new Date('2026-11-24T10:00:00Z');
    const first = publishStorefrontDraft({ draft: { heroImages: ['h1'], about: 'Hi' }, versions: [] }, now);
    expect(first.publishedVersion).toBe(1);
    expect(first.versions).toEqual([{ version: 1, publishedAt: now.toISOString(), content: { heroImages: ['h1'], about: 'Hi' } }]);

    const versions: StorefrontVersionEntry[] = Array.from({ length: STOREFRONT_VERSION_HISTORY_LIMIT }, (_, i) => ({
      version: STOREFRONT_VERSION_HISTORY_LIMIT - i, publishedAt: 'x', content: { heroImages: [] },
    }));
    const next = publishStorefrontDraft({ draft: { heroImages: [] }, versions, publishedVersion: STOREFRONT_VERSION_HISTORY_LIMIT }, now);
    expect(next.publishedVersion).toBe(STOREFRONT_VERSION_HISTORY_LIMIT + 1);
    expect(next.versions).toHaveLength(STOREFRONT_VERSION_HISTORY_LIMIT);
    expect(next.versions[0].version).toBe(STOREFRONT_VERSION_HISTORY_LIMIT + 1);
    expect(next.versions.at(-1)!.version).toBe(2);
  });

  it('rolls back by re-publishing an old version as a new one', () => {
    const doc = {
      draft: { heroImages: ['draft'] },
      publishedVersion: 2,
      versions: [
        { version: 2, publishedAt: 'b', content: { heroImages: ['v2'] } },
        { version: 1, publishedAt: 'a', content: { heroImages: ['v1'] } },
      ],
    };
    const result = rollbackStorefront(doc, 1, new Date('2026-11-24T10:00:00Z'))!;
    expect(result.publishedVersion).toBe(3);
    expect(result.published).toEqual({ heroImages: ['v1'] });
    expect(result.draft).toEqual({ heroImages: ['v1'] });
    expect(result.versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(rollbackStorefront(doc, 9)).toBeNull();
  });
});
