/**
 * demo-api.ts — DEMO MODE implementation of the storefront API client.
 *
 * Active only when VITE_DEMO_MODE=true; api.ts swaps these objects in for the
 * real fetch-backed client, so the rest of the app never knows which is
 * active. Everything is served/simulated locally from SAMPLE fixtures
 * (lib/demo-fixtures.ts, generated from packages/db/src/seeds/ordering-demo.ts):
 *
 *   - config + menu           → static fixtures
 *   - login/register/me       → local demo customer session (same token keys
 *                               as the real client, so AuthContext just works)
 *   - order placement         → fake ids + totals computed from fixtures,
 *                               persisted to localStorage so the tracking page
 *                               and account order history keep working
 *   - order tracking          → status progresses over time for a live feel
 *   - reservations/addresses  → succeed locally (localStorage)
 *
 * Simulated backend writes trigger the once-per-session
 * "Demo preview — backend not connected" notice (lib/demo.ts).
 */
import type {
  CustomerAddress,
  Order,
  OrderItemSnapshot,
  OrderStatus,
  PublicCustomer,
} from '@restropulse/shared';
import type { OrderTrackingInfo, PublicMenuCategory, PublicMenuItem, StorefrontConfig } from './types';
import type { CustomerAuthResult, PlaceOrderPayload, ReservationPayload } from './api';
import {
  ApiError,
  clearToken,
  getStoredCustomer,
  getToken,
  setToken,
  storeCustomer,
} from './lib/api-core';
import { DEMO_SLUG, notifyDemoBackendAction } from './lib/demo';
import { DEMO_FIXTURE_CONFIG, DEMO_FIXTURE_CUSTOMER, DEMO_FIXTURE_MENU } from './lib/demo-fixtures';
import { roundMoney } from './lib/cart';

/** Simulated latency so loading states stay visible in the static preview. */
const DEMO_LATENCY_MS = 200;

const delay = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, DEMO_LATENCY_MS));

const randomSuffix = (): string => Math.random().toString(36).slice(2, 8);

function assertDemoSlug(slug: string): void {
  if (slug !== DEMO_SLUG) throw new ApiError('Restaurant not found', 404);
}

/** Deep-copy fixtures so callers can never mutate the module-level objects. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ----- localStorage-backed demo persistence -----

const ordersKey = (slug: string): string => `sf_demo_orders_${slug}`;
const addressesKey = (slug: string): string => `sf_demo_addresses_${slug}`;
const reservationsKey = (slug: string): string => `sf_demo_reservations_${slug}`;

function readJson<T>(key: string, fallbackValue: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallbackValue;
  } catch {
    return fallbackValue;
  }
}

function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

// ----- Public: config + menu -----

export const storefrontAPI = {
  getConfig: async (slug: string): Promise<StorefrontConfig> => {
    assertDemoSlug(slug);
    await delay();
    return clone(DEMO_FIXTURE_CONFIG);
  },

  getMenu: async (slug: string): Promise<PublicMenuCategory[]> => {
    assertDemoSlug(slug);
    await delay();
    return clone(DEMO_FIXTURE_MENU);
  },
};

// ----- Customer auth (local demo session) -----

function startDemoSession(slug: string, customer: PublicCustomer): CustomerAuthResult {
  setToken(slug, `demo-token-${randomSuffix()}`);
  storeCustomer(slug, customer);
  notifyDemoBackendAction();
  return { customer, token: getToken(slug)!, refreshToken: `demo-refresh-${randomSuffix()}` };
}

export const customerAuthAPI = {
  register: async (
    slug: string,
    data: { email: string; password: string; name?: string; phone?: string },
  ): Promise<CustomerAuthResult> => {
    assertDemoSlug(slug);
    await delay();
    const customer: PublicCustomer = {
      ...clone(DEMO_FIXTURE_CUSTOMER),
      email: data.email,
      ...(data.name ? { name: data.name } : {}),
      ...(data.phone ? { phone: data.phone } : {}),
    };
    return startDemoSession(slug, customer);
  },

  // Demo mode accepts any credentials and signs in the sample customer.
  login: async (slug: string, email: string, _password: string): Promise<CustomerAuthResult> => {
    assertDemoSlug(slug);
    await delay();
    const customer: PublicCustomer = { ...clone(DEMO_FIXTURE_CUSTOMER), email };
    return startDemoSession(slug, customer);
  },

  me: async (slug: string): Promise<PublicCustomer> => {
    assertDemoSlug(slug);
    await delay();
    if (!getToken(slug)) throw new ApiError('Not authenticated', 401);
    const customer = getStoredCustomer(slug) ?? clone(DEMO_FIXTURE_CUSTOMER);
    storeCustomer(slug, customer);
    return customer;
  },

  logout: (slug: string): void => {
    clearToken(slug);
  },
};

// ----- Addresses -----

export const addressAPI = {
  list: async (slug: string): Promise<CustomerAddress[]> => {
    assertDemoSlug(slug);
    await delay();
    return readJson<CustomerAddress[]>(addressesKey(slug), clone(DEMO_FIXTURE_CUSTOMER.addresses));
  },

  add: async (slug: string, address: Omit<CustomerAddress, 'id'>): Promise<CustomerAddress> => {
    assertDemoSlug(slug);
    await delay();
    const existing = readJson<CustomerAddress[]>(addressesKey(slug), clone(DEMO_FIXTURE_CUSTOMER.addresses));
    const created: CustomerAddress = { ...address, id: `demo-addr-${randomSuffix()}` };
    writeJson(addressesKey(slug), [...existing, created]);
    notifyDemoBackendAction();
    return created;
  },
};

// ----- Orders -----

const menuItemIndex = new Map<string, PublicMenuItem>(
  DEMO_FIXTURE_MENU.flatMap((category) => category.items.map((i) => [i.id, i] as const)),
);

const DEMO_STATUS_NOTE = '[DEMO] Order simulated locally — no kitchen was notified.';

/** Fake kitchen timeline: how long after placement each status is reached. */
const STATUS_TIMELINE: Array<{ afterMs: number; status: OrderStatus }> = [
  { afterMs: 0, status: 'RECEIVED' },
  { afterMs: 60_000, status: 'PREPARING' },
  { afterMs: 150_000, status: 'READY' },
  { afterMs: 210_000, status: 'OUT_FOR_DELIVERY' },
  { afterMs: 270_000, status: 'COMPLETED' },
];

/** Derives a live-looking status from the order's age (demo only). */
function withSimulatedProgress(order: Order): Order {
  const placedAt = new Date(String(order.createdAt)).getTime();
  const elapsed = Math.max(0, Date.now() - placedAt);
  const flow = STATUS_TIMELINE.filter(
    (step) => order.orderType === 'delivery' || step.status !== 'OUT_FOR_DELIVERY',
  );
  const reached = flow.filter((step) => elapsed >= step.afterMs);
  const statusHistory = reached.map((step, idx) => ({
    status: step.status,
    at: new Date(placedAt + step.afterMs).toISOString(),
    ...(idx === 0 ? { note: DEMO_STATUS_NOTE } : {}),
  }));
  const status = reached[reached.length - 1]?.status ?? order.status;
  return { ...order, status, statusHistory, updatedAt: new Date().toISOString() };
}

function findOrder(slug: string, orderId: string, orderNumber?: string): Order {
  const orders = readJson<Order[]>(ordersKey(slug), []);
  const found = orders.find((o) => o.id === orderId)
    ?? (orderNumber ? orders.find((o) => o.orderNumber === orderNumber) : undefined);
  if (!found) throw new ApiError('Order not found', 404);
  return found;
}

/** Resolves payload lines against the fixture menu (mirrors the server). */
function buildItemSnapshots(payload: PlaceOrderPayload): OrderItemSnapshot[] {
  return payload.items.map((line) => {
    const item = menuItemIndex.get(line.menuItemId);
    if (!item || item.soldOut) throw new ApiError('One of the items is unavailable', 400);
    const variant = line.variantId ? item.variants.find((v) => v.id === line.variantId) : undefined;
    if (line.variantId && !variant) throw new ApiError('Unknown item variant', 400);
    const addons = (line.addonIds ?? []).map((addonId) => {
      const addon = item.addons.find((a) => a.id === addonId);
      if (!addon) throw new ApiError('Unknown item addon', 400);
      return { id: addon.id, name: addon.name, price: addon.price };
    });
    const unitPrice = variant ? variant.price : item.price;
    const addonsPerUnit = addons.reduce((sum, a) => sum + a.price, 0);
    return {
      menuItemId: item.id,
      name: item.name,
      qty: line.qty,
      unitPrice,
      ...(variant ? { variant: { id: variant.id, name: variant.name, price: variant.price } } : {}),
      ...(addons.length > 0 ? { addons } : {}),
      lineTotal: roundMoney((unitPrice + addonsPerUnit) * line.qty),
    };
  });
}

export const orderAPI = {
  place: async (slug: string, payload: PlaceOrderPayload, idempotencyKey: string): Promise<Order> => {
    assertDemoSlug(slug);
    await delay();
    if (!getToken(slug)) throw new ApiError('Not authenticated', 401);

    const existing = readJson<Order[]>(ordersKey(slug), []);
    const replay = existing.find((o) => o.idempotencyKey === idempotencyKey);
    if (replay) return withSimulatedProgress(replay);

    const items = buildItemSnapshots(payload);
    const ordering = DEMO_FIXTURE_CONFIG.restaurant.ordering;
    const subtotal = roundMoney(items.reduce((sum, i) => sum + i.lineTotal, 0));
    const tax = roundMoney(subtotal * ((ordering?.taxRatePercent ?? 0) / 100));
    const deliveryFee =
      payload.orderType === 'delivery' ? roundMoney(ordering?.delivery?.flatFee ?? 0) : 0;
    const totals = {
      subtotal,
      tax,
      deliveryFee,
      discount: 0,
      total: roundMoney(subtotal + tax + deliveryFee),
    };

    const customer = getStoredCustomer(slug);
    const now = new Date().toISOString();
    const order: Order = {
      id: `demo-ord-${Date.now().toString(36)}-${randomSuffix()}`,
      restaurantId: DEMO_FIXTURE_CONFIG.restaurant.id,
      customerId: customer?.id ?? DEMO_FIXTURE_CUSTOMER.id,
      orderNumber: `ORD-${randomSuffix().toUpperCase()}`,
      orderType: payload.orderType,
      items,
      totals,
      status: 'RECEIVED',
      statusHistory: [{ status: 'RECEIVED', at: now, note: DEMO_STATUS_NOTE }],
      ...(payload.address ? { address: payload.address } : {}),
      ...(customer?.name ? { customerName: customer.name } : {}),
      ...(customer?.phone ? { customerPhone: customer.phone } : {}),
      idempotencyKey,
      createdAt: now,
      updatedAt: now,
    };

    writeJson(ordersKey(slug), [order, ...existing]);
    notifyDemoBackendAction();
    return order;
  },

  list: async (slug: string): Promise<Order[]> => {
    assertDemoSlug(slug);
    await delay();
    return readJson<Order[]>(ordersKey(slug), []).map(withSimulatedProgress);
  },

  get: async (slug: string, orderId: string): Promise<Order> => {
    assertDemoSlug(slug);
    await delay();
    return withSimulatedProgress(findOrder(slug, orderId));
  },

  track: async (
    slug: string,
    orderId: string,
    fallback?: { orderNumber: string; phone: string },
  ): Promise<OrderTrackingInfo> => {
    assertDemoSlug(slug);
    await delay();
    const order = withSimulatedProgress(findOrder(slug, orderId, fallback?.orderNumber));
    return {
      orderNumber: order.orderNumber,
      status: order.status,
      orderType: order.orderType,
      statusHistory: order.statusHistory,
      placedAt: String(order.createdAt),
    };
  },
};

// ----- Reservations -----

export const reservationAPI = {
  create: async (slug: string, payload: ReservationPayload): Promise<void> => {
    assertDemoSlug(slug);
    await delay();
    const existing = readJson<Array<Record<string, unknown>>>(reservationsKey(slug), []);
    writeJson(reservationsKey(slug), [
      { ...payload, id: `demo-res-${randomSuffix()}`, status: 'pending', createdAt: new Date().toISOString() },
      ...existing,
    ]);
    notifyDemoBackendAction();
  },
};
