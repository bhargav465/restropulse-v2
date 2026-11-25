import { describe, it, expect } from 'vitest';
import {
  priceOrder,
  OrderValidationError,
  canTransitionOrderStatus,
  restaurantNextStatuses,
  canRestaurantCancel,
  isOrderStatus,
  resolveOrderingSettings,
  isOrderTypeEnabled,
  deliveryFeeFor,
  toPaise,
  roundMoney,
  toPublicOrder,
  isValidRestaurantSlug,
  slugifyRestaurantName,
  DEFAULT_ORDERING_SETTINGS,
  ORDER_STATUS_LABELS,
  ORDER_STATUSES,
  MAX_QTY_PER_LINE,
  MAX_ORDER_LINES,
} from '../src/index.js';
import type { Offer, Order, OrderingMenuItem, RestaurantOrderingSettings } from '../src/index.js';

const WED_NOON_IST = new Date('2026-11-25T06:30:00Z');

const item = (over: Partial<OrderingMenuItem> & Pick<OrderingMenuItem, 'id' | 'name'>): OrderingMenuItem => ({
  restaurantId: 'r1', categoryId: 'c1', price: 100, isVeg: true, availability: 'in_stock', sortOrder: 1, ...over,
});

const catalog: OrderingMenuItem[] = [
  item({ id: 'biryani', name: 'Biryani', price: 250, variants: [{ id: 'half', name: 'Half', price: 150 }, { id: 'full', name: 'Full', price: 250 }], addons: [{ id: 'raita', name: 'Raita', price: 30 }, { id: 'egg', name: 'Egg', price: 20 }] }),
  item({ id: 'lassi', name: 'Lassi', price: 80, categoryId: 'drinks' }),
  item({ id: 'kebab', name: 'Kebab', price: 300, availability: 'out_of_stock' }),
];

const settings = (over: Partial<RestaurantOrderingSettings> = {}): RestaurantOrderingSettings => ({
  ...DEFAULT_ORDERING_SETTINGS,
  storeOpen: true,
  taxRatePercent: 5,
  delivery: { enabled: true, flatFee: 40, minOrder: 200, freeAbove: 1000 },
  ...over,
});

const offer = (over: Partial<Offer> = {}): Offer => ({
  id: 'o1', restaurantId: 'r1', title: '10% off', reward: { kind: 'percent_off', percent: 10 }, scope: { kind: 'all' },
  schedule: { startsAt: '2026-11-01T00:00:00Z' }, showOnSite: true, promoteInContent: false, status: 'active', ...over,
});

const expectCode = (fn: () => unknown, code: string) => {
  try { fn(); } catch (e) {
    expect(e).toBeInstanceOf(OrderValidationError);
    expect((e as OrderValidationError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
};

describe('priceOrder', () => {
  it('prices variants, add-ons, tax and delivery from the catalog', () => {
    const priced = priceOrder(
      [{ menuItemId: 'biryani', qty: 2, variantId: 'half', addonIds: ['raita', 'raita'] }, { menuItemId: 'lassi', qty: 1 }],
      catalog,
      { orderType: 'delivery', settings: settings(), now: WED_NOON_IST },
    );
    expect(priced.items[0]).toMatchObject({ unitPrice: 150, variant: { id: 'half' }, lineTotal: 360 });
    expect(priced.items[0].addons).toHaveLength(1); // duplicates collapse
    expect(priced.items[1]).not.toHaveProperty('variant');
    expect(priced.totals).toEqual({ subtotal: 440, discount: 0, deliveryFee: 40, deliveryDiscount: 0, tax: 22, total: 502 });
    expect(priced.offer).toBeUndefined();
  });

  it('charges no delivery for pickup and skips the delivery minimum', () => {
    const priced = priceOrder([{ menuItemId: 'lassi', qty: 1 }], catalog, { orderType: 'pickup', settings: settings() });
    expect(priced.totals).toMatchObject({ subtotal: 80, deliveryFee: 0, tax: 4, total: 84 });
  });

  it('waives delivery above the free-above threshold', () => {
    const priced = priceOrder([{ menuItemId: 'biryani', qty: 4 }], catalog, { orderType: 'delivery', settings: settings() });
    expect(priced.totals.deliveryFee).toBe(0);
  });

  it('rejects bad requests with typed codes', () => {
    const opts = { orderType: 'pickup' as const, settings: settings() };
    expectCode(() => priceOrder([], catalog, opts), 'EMPTY_ORDER');
    expectCode(() => priceOrder(Array.from({ length: MAX_ORDER_LINES + 1 }, () => ({ menuItemId: 'lassi', qty: 1 })), catalog, opts), 'TOO_MANY_LINES');
    expectCode(() => priceOrder([{ menuItemId: 'lassi', qty: 0 }], catalog, opts), 'INVALID_QTY');
    expectCode(() => priceOrder([{ menuItemId: 'lassi', qty: 1.5 }], catalog, opts), 'INVALID_QTY');
    expectCode(() => priceOrder([{ menuItemId: 'lassi', qty: MAX_QTY_PER_LINE + 1 }], catalog, opts), 'INVALID_QTY');
    expectCode(() => priceOrder([{ menuItemId: 'nope', qty: 1 }], catalog, opts), 'ITEM_NOT_FOUND');
    expectCode(() => priceOrder([{ menuItemId: 'kebab', qty: 1 }], catalog, opts), 'ITEM_UNAVAILABLE');
    expectCode(() => priceOrder([{ menuItemId: 'biryani', qty: 1, variantId: 'jumbo' }], catalog, opts), 'VARIANT_NOT_FOUND');
    expectCode(() => priceOrder([{ menuItemId: 'biryani', qty: 1, addonIds: ['cheese'] }], catalog, opts), 'ADDON_NOT_FOUND');
    expectCode(() => priceOrder([{ menuItemId: 'lassi', qty: 1 }], catalog, { orderType: 'delivery', settings: settings() }), 'MIN_ORDER_NOT_MET');
  });

  it('applies an explicit code offer and records it', () => {
    const priced = priceOrder([{ menuItemId: 'biryani', qty: 2 }], catalog, {
      orderType: 'pickup', settings: settings(), offer: offer({ code: 'SAVE10' }), now: WED_NOON_IST,
    });
    expect(priced.totals).toMatchObject({ subtotal: 500, discount: 50, tax: 22.5, total: 472.5 });
    expect(priced.offer).toEqual({ offerId: 'o1', title: '10% off', code: 'SAVE10', discount: 50, deliveryDiscount: 0 });
  });

  it('explains why an explicit offer does not apply', () => {
    const base = { orderType: 'pickup' as const, settings: settings(), now: WED_NOON_IST };
    const run = (o: Offer) => { try { priceOrder([{ menuItemId: 'lassi', qty: 1 }], catalog, { ...base, offer: o }); return ''; } catch (e) { return (e as OrderValidationError).message; } };
    expect(run(offer({ minOrderValue: 500 }))).toMatch(/₹500/);
    expect(run(offer({ status: 'paused' }))).toMatch(/isn't valid/);
    expect(run(offer({ scope: { kind: 'items', itemIds: ['biryani'] } }))).toMatch(/doesn't apply/);
  });

  it('picks the best code-less live offer automatically', () => {
    const priced = priceOrder([{ menuItemId: 'biryani', qty: 2 }], catalog, {
      orderType: 'delivery', settings: settings(), now: WED_NOON_IST,
      autoOffers: [
        offer({ id: 'small', reward: { kind: 'flat_off', amount: 20 } }),
        offer({ id: 'big', title: 'Flat 75', reward: { kind: 'flat_off', amount: 75 } }),
        offer({ id: 'coded', code: 'X', reward: { kind: 'flat_off', amount: 200 } }),
        offer({ id: 'paused', status: 'paused', reward: { kind: 'flat_off', amount: 200 } }),
      ],
    });
    expect(priced.offer?.offerId).toBe('big');
    expect(priced.totals.discount).toBe(75);
  });

  it('free delivery offers only apply to delivery orders and cap at the fee', () => {
    const free = offer({ id: 'fd', title: 'Free delivery', reward: { kind: 'free_delivery' } });
    const pickup = priceOrder([{ menuItemId: 'biryani', qty: 1 }], catalog, { orderType: 'pickup', settings: settings(), autoOffers: [free], now: WED_NOON_IST });
    expect(pickup.offer).toBeUndefined();
    const delivery = priceOrder([{ menuItemId: 'biryani', qty: 1 }], catalog, { orderType: 'delivery', settings: settings(), autoOffers: [free], now: WED_NOON_IST });
    expect(delivery.totals).toMatchObject({ deliveryFee: 40, deliveryDiscount: 40, total: 262.5 });
    expect(delivery.offer).toMatchObject({ offerId: 'fd', deliveryDiscount: 40 });
    expect(delivery.offer).not.toHaveProperty('code');
  });

  it('never discounts below zero', () => {
    const priced = priceOrder([{ menuItemId: 'lassi', qty: 1 }], catalog, {
      orderType: 'pickup', settings: settings(), now: WED_NOON_IST, offer: offer({ reward: { kind: 'flat_off', amount: 500 } }),
    });
    expect(priced.totals).toMatchObject({ discount: 80, tax: 0, total: 0 });
  });
});

describe('status machine', () => {
  it('allows the kitchen flow and blocks shortcuts', () => {
    expect(canTransitionOrderStatus('RECEIVED', 'PREPARING', 'pickup')).toBe(true);
    expect(canTransitionOrderStatus('RECEIVED', 'READY', 'pickup')).toBe(false);
    expect(canTransitionOrderStatus('READY', 'OUT_FOR_DELIVERY', 'pickup')).toBe(false);
    expect(canTransitionOrderStatus('READY', 'OUT_FOR_DELIVERY', 'delivery')).toBe(true);
    expect(canTransitionOrderStatus('READY', 'COMPLETED', 'delivery')).toBe(false);
    expect(canTransitionOrderStatus('READY', 'COMPLETED', 'dine_in')).toBe(true);
    expect(canTransitionOrderStatus('COMPLETED', 'CANCELLED', 'pickup')).toBe(false);
  });

  it('lists only the restaurant moves', () => {
    expect(restaurantNextStatuses({ status: 'RECEIVED', orderType: 'pickup' })).toEqual(['PREPARING']);
    expect(restaurantNextStatuses({ status: 'READY', orderType: 'delivery' })).toEqual(['OUT_FOR_DELIVERY']);
    expect(restaurantNextStatuses({ status: 'READY', orderType: 'pickup' })).toEqual(['COMPLETED']);
    expect(restaurantNextStatuses({ status: 'COMPLETED', orderType: 'pickup' })).toEqual([]);
    expect(canRestaurantCancel({ status: 'PREPARING' })).toBe(true);
    expect(canRestaurantCancel({ status: 'CANCELLED' })).toBe(false);
  });

  it('labels every status and validates names', () => {
    for (const s of ORDER_STATUSES) expect(ORDER_STATUS_LABELS[s]).toBeTruthy();
    expect(isOrderStatus('READY')).toBe(true);
    expect(isOrderStatus('ready')).toBe(false);
    expect(isOrderStatus(3)).toBe(false);
  });
});

describe('settings and money helpers', () => {
  it('merges partial settings over defaults', () => {
    const s = resolveOrderingSettings({ storeOpen: true, delivery: { enabled: true } as RestaurantOrderingSettings['delivery'] });
    expect(s.storeOpen).toBe(true);
    expect(s.delivery).toEqual({ enabled: true, flatFee: 0, minOrder: 0 });
    expect(s.pickup.enabled).toBe(true);
    expect(resolveOrderingSettings(null)).toEqual(DEFAULT_ORDERING_SETTINGS);
    expect(isOrderTypeEnabled(s, 'delivery')).toBe(true);
    expect(isOrderTypeEnabled(s, 'pickup')).toBe(true);
    expect(isOrderTypeEnabled(s, 'dine_in')).toBe(false);
  });

  it('rounds money and converts to paise', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(toPaise(472.5)).toBe(47250);
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(deliveryFeeFor({ flatFee: 40, minOrder: 0 }, 5000)).toBe(40);
    expect(deliveryFeeFor({ flatFee: -5, minOrder: 0 }, 10)).toBe(0);
  });

  it('strips the tracking token from the public order', () => {
    const order: Order = {
      id: 'ord1', restaurantId: 'r1', orderNumber: 'RP-ABC123', trackingToken: 'secret', orderType: 'pickup',
      items: [], totals: { subtotal: 0, discount: 0, deliveryFee: 0, deliveryDiscount: 0, tax: 0, total: 0 },
      status: 'RECEIVED', statusHistory: [{ status: 'RECEIVED', at: '2026-11-25T06:30:00Z', by: 'system', note: 'internal' }],
      paymentMethod: 'cash', customerName: 'A', customerPhone: '9999999999',
      createdAt: '2026-11-25T06:30:00Z', updatedAt: '2026-11-25T06:30:00Z',
    };
    const pub = toPublicOrder(order);
    expect(pub).not.toHaveProperty('trackingToken');
    expect(pub).not.toHaveProperty('customerPhone');
    expect(pub.statusHistory).toEqual([{ status: 'RECEIVED', at: '2026-11-25T06:30:00Z' }]);
    expect(toPublicOrder({ ...order, offer: { offerId: 'o', title: 't', discount: 1, deliveryDiscount: 0 } }).offer?.offerId).toBe('o');
  });

  it('validates and suggests slugs', () => {
    expect(isValidRestaurantSlug('bawarchi-kitchen')).toBe(true);
    expect(isValidRestaurantSlug('ab')).toBe(false);
    expect(isValidRestaurantSlug('Bad-Slug')).toBe(false);
    expect(isValidRestaurantSlug('double--hyphen')).toBe(false);
    expect(isValidRestaurantSlug('-lead')).toBe(false);
    expect(slugifyRestaurantName("Bawarchi's Kitchen!")).toBe('bawarchis-kitchen');
    expect(slugifyRestaurantName('Café  Délice')).toBe('cafe-delice');
    expect(slugifyRestaurantName('a'.repeat(47) + ' b')).toBe('a'.repeat(47));
  });
});
