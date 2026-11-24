// -------------------------------------------------------
// @restropulse/shared - orders, payments and ordering settings (Phase 2, M2)
//
// Types plus pure logic (status machine, pricing). The API is the authority;
// the web dashboard imports the same status machine so the two never drift.
// -------------------------------------------------------

import type { Offer, OrderingMenuItem } from './ordering.js';
import { computeOfferDiscount, isOfferLive, DEFAULT_RESTAURANT_TIME_ZONE } from './cms.js';

// ----- Types -----

export type OrderType = 'delivery' | 'pickup' | 'dine_in';
export const ORDER_TYPES: readonly OrderType[] = ['delivery', 'pickup', 'dine_in'];

export type OrderStatus =
  | 'PENDING_PAYMENT'    // created, waiting for the online payment
  | 'PAYMENT_FAILED'     // payment attempt failed; the customer may retry
  | 'RECEIVED'           // the restaurant has the order
  | 'PREPARING'
  | 'READY'              // ready for pickup / hand-off to a rider
  | 'OUT_FOR_DELIVERY'   // delivery orders only
  | 'COMPLETED'
  | 'CANCELLED';

export type PaymentMethod = 'online' | 'cash';
export const PAYMENT_METHODS: readonly PaymentMethod[] = ['online', 'cash'];

/** Amounts in INR (rupees, 2 decimals). Payments convert to paise at the edge. */
export interface OrderTotals {
  subtotal: number;
  /** Item discount from an offer. */
  discount: number;
  deliveryFee: number;
  /** Delivery fee waived by an offer (free delivery). */
  deliveryDiscount: number;
  /** Tax on (subtotal - discount). Delivery is not taxed. */
  tax: number;
  total: number;
}

/** Immutable snapshot of what was ordered (prices resolved server-side). */
export interface OrderItemSnapshot {
  menuItemId: string;
  categoryId: string;
  name: string;
  qty: number;
  /** Per-unit price: the variant price if one was picked, else the base price. */
  unitPrice: number;
  variant?: { id: string; name: string; price: number };
  addons?: Array<{ id: string; name: string; price: number }>;
  /** (unitPrice + sum(addons)) * qty */
  lineTotal: number;
}

export interface OrderAddress {
  line1: string;
  line2?: string;
  city?: string;
  pincode?: string;
  landmark?: string;
  lat?: number;
  lng?: number;
}

export interface OrderStatusHistoryEntry {
  status: OrderStatus;
  at: string;              // ISO timestamp
  /** Who moved it: the restaurant, the customer (payment), or the system (webhook). */
  by: 'restaurant' | 'customer' | 'system';
  note?: string;
}

export interface AppliedOffer {
  offerId: string;
  title: string;
  code?: string;
  discount: number;
  deliveryDiscount: number;
}

export type OrderPaymentStatus = 'not_required' | 'pending' | 'paid' | 'failed' | 'refund_pending' | 'refunded';

export interface Order {
  id: string;
  restaurantId: string;
  /** Short human reference, e.g. RP-K3X9F2. Unique. */
  orderNumber: string;
  /** Secret for the customer's tracking link. Never shown in the dashboard list. */
  trackingToken: string;
  orderType: OrderType;
  items: OrderItemSnapshot[];
  totals: OrderTotals;
  offer?: AppliedOffer;
  status: OrderStatus;
  statusHistory: OrderStatusHistoryEntry[];
  paymentMethod: PaymentMethod;
  paymentStatus: OrderPaymentStatus;
  customerName: string;
  customerPhone: string;
  address?: OrderAddress;
  /** Dine-in table, e.g. "T4". */
  table?: string;
  notes?: string;
  cancelReason?: string;
  /** Client Idempotency-Key header; unique per restaurant. */
  idempotencyKey?: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** What the customer's tracking page may see (no token, no internal ids beyond the order's own). */
export type PublicOrder = Pick<Order,
  'id' | 'orderNumber' | 'orderType' | 'items' | 'totals' | 'offer' | 'status' | 'paymentMethod' | 'paymentStatus' | 'createdAt'
> & { statusHistory: Array<Pick<OrderStatusHistoryEntry, 'status' | 'at'>> };

// ----- Payments (one document per online payment attempt) -----

export type PaymentStatus = 'created' | 'captured' | 'failed' | 'refund_pending' | 'refunded';

export interface PaymentEventEntry {
  at: string;
  /** e.g. intent_created | verify_ok | verify_failed | webhook:payment.captured | refund_requested */
  type: string;
  source: 'intent' | 'verify' | 'webhook' | 'restaurant';
  /** Razorpay webhook event id, used to ignore redeliveries. */
  eventId?: string;
  providerPaymentId?: string;
  errorCode?: string;
  errorDescription?: string;
}

export interface Payment {
  id: string;
  restaurantId: string;
  orderId: string;
  provider: 'razorpay';
  /** Razorpay order id (order_xxx). Unique. */
  providerOrderId: string;
  /** Razorpay payment id (pay_xxx), once known. */
  providerPaymentId?: string;
  providerRefundId?: string;
  /** PAISE, computed server-side from the order total. */
  amount: number;
  currency: 'INR';
  status: PaymentStatus;
  events: PaymentEventEntry[];
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** What the storefront needs to open Razorpay Checkout. */
export interface PaymentIntent {
  providerOrderId: string;
  keyId: string;
  amount: number;          // PAISE
  currency: 'INR';
}

// ----- Ordering settings (on the restaurant) -----

/** Delivery fee rule (v1): a flat fee, optionally waived above a subtotal. */
export interface DeliveryFeeRule {
  flatFee: number;
  /** Subtotal (after item discount) at or above which delivery is free. */
  freeAbove?: number;
  /** Minimum subtotal for delivery orders. */
  minOrder: number;
}

export interface RestaurantOrderingSettings {
  /** Master switch: when false the site shows "closed for orders". */
  storeOpen: boolean;
  /** Tax percentage on (subtotal - discount), e.g. 5 => 5%. */
  taxRatePercent: number;
  delivery: { enabled: boolean } & DeliveryFeeRule;
  pickup: { enabled: boolean };
  dineIn: { enabled: boolean };
  /** Accept cash (on delivery / at the counter) as well as online payment. */
  cashAccepted: boolean;
}

export const DEFAULT_ORDERING_SETTINGS: RestaurantOrderingSettings = {
  storeOpen: false,
  taxRatePercent: 5,
  delivery: { enabled: false, flatFee: 0, minOrder: 0 },
  pickup: { enabled: true },
  dineIn: { enabled: false },
  cashAccepted: false,
};

/** Merge stored (possibly partial) settings over the defaults. */
export function resolveOrderingSettings(stored?: Partial<RestaurantOrderingSettings> | null): RestaurantOrderingSettings {
  const s = stored ?? {};
  return {
    ...DEFAULT_ORDERING_SETTINGS,
    ...s,
    delivery: { ...DEFAULT_ORDERING_SETTINGS.delivery, ...(s.delivery ?? {}) },
    pickup: { ...DEFAULT_ORDERING_SETTINGS.pickup, ...(s.pickup ?? {}) },
    dineIn: { ...DEFAULT_ORDERING_SETTINGS.dineIn, ...(s.dineIn ?? {}) },
  };
}

export function isOrderTypeEnabled(settings: RestaurantOrderingSettings, type: OrderType): boolean {
  if (type === 'delivery') return settings.delivery.enabled;
  if (type === 'pickup') return settings.pickup.enabled;
  return settings.dineIn.enabled;
}

// ----- Status machine -----

export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_PAYMENT: ['RECEIVED', 'PAYMENT_FAILED', 'CANCELLED'],
  PAYMENT_FAILED: ['PENDING_PAYMENT', 'RECEIVED', 'CANCELLED'],
  RECEIVED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const ORDER_STATUSES = Object.keys(ORDER_STATUS_TRANSITIONS) as OrderStatus[];

/** Statuses the kitchen works through, in order. */
export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = ['RECEIVED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as string[]).includes(value);
}

/**
 * Whether `from -> to` is allowed for this order type.
 * - OUT_FOR_DELIVERY only exists for delivery orders.
 * - A delivery order must go READY -> OUT_FOR_DELIVERY -> COMPLETED.
 */
export function canTransitionOrderStatus(from: OrderStatus, to: OrderStatus, orderType: OrderType): boolean {
  if (!ORDER_STATUS_TRANSITIONS[from]?.includes(to)) return false;
  if (to === 'OUT_FOR_DELIVERY' && orderType !== 'delivery') return false;
  if (from === 'READY' && to === 'COMPLETED' && orderType === 'delivery') return false;
  return true;
}

/**
 * Transitions the restaurant may make from the dashboard. Payment states are
 * driven by the customer and Razorpay, so they never appear here; cancelling
 * goes through its own action (it may refund).
 */
export function restaurantNextStatuses(order: Pick<Order, 'status' | 'orderType'>): OrderStatus[] {
  if (order.status === 'PENDING_PAYMENT' || order.status === 'PAYMENT_FAILED') return [];
  return ORDER_STATUS_TRANSITIONS[order.status]
    .filter((to) => to !== 'CANCELLED' && canTransitionOrderStatus(order.status, to, order.orderType));
}

export function canRestaurantCancel(order: Pick<Order, 'status'>): boolean {
  return ORDER_STATUS_TRANSITIONS[order.status].includes('CANCELLED');
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  PAYMENT_FAILED: 'Payment failed',
  RECEIVED: 'New',
  PREPARING: 'Preparing',
  READY: 'Ready',
  OUT_FOR_DELIVERY: 'Out for delivery',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

// ----- Pricing -----

export type OrderValidationCode =
  | 'EMPTY_ORDER'
  | 'TOO_MANY_LINES'
  | 'INVALID_QTY'
  | 'ITEM_NOT_FOUND'
  | 'ITEM_UNAVAILABLE'
  | 'VARIANT_NOT_FOUND'
  | 'ADDON_NOT_FOUND'
  | 'MIN_ORDER_NOT_MET'
  | 'OFFER_NOT_APPLICABLE';

export class OrderValidationError extends Error {
  readonly code: OrderValidationCode;
  constructor(code: OrderValidationCode, message: string) {
    super(message);
    this.name = 'OrderValidationError';
    this.code = code;
  }
}

export interface RequestedOrderItem {
  menuItemId: string;
  qty: number;
  variantId?: string;
  addonIds?: string[];
}

export const MAX_QTY_PER_LINE = 50;
export const MAX_ORDER_LINES = 50;

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Rupees to integer paise for the payment gateway. */
export function toPaise(rupees: number): number {
  return Math.round(roundMoney(rupees) * 100);
}

/** Delivery fee for a subtotal under the rule (0 when free-above applies). */
export function deliveryFeeFor(rule: DeliveryFeeRule, subtotalAfterDiscount: number): number {
  if (rule.freeAbove !== undefined && subtotalAfterDiscount >= rule.freeAbove) return 0;
  return roundMoney(Math.max(0, rule.flatFee));
}

export interface PriceOrderOptions {
  orderType: OrderType;
  settings: RestaurantOrderingSettings;
  /** An offer the customer chose (by code). Must apply or pricing fails. */
  offer?: Offer;
  /** Code-less live offers to consider; the best one is applied automatically. */
  autoOffers?: Offer[];
  now?: Date;
  timeZone?: string;
}

export interface PricedOrder {
  items: OrderItemSnapshot[];
  totals: OrderTotals;
  offer?: AppliedOffer;
}

/**
 * Validates requested lines against the stored catalog and prices the order.
 * Client prices are never read. An explicit offer that doesn't apply throws
 * OFFER_NOT_APPLICABLE; otherwise the code-less offer that saves the most is used.
 * @throws OrderValidationError
 */
export function priceOrder(requested: RequestedOrderItem[], catalog: OrderingMenuItem[], opts: PriceOrderOptions): PricedOrder {
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new OrderValidationError('EMPTY_ORDER', 'Add at least one item.');
  }
  if (requested.length > MAX_ORDER_LINES) {
    throw new OrderValidationError('TOO_MANY_LINES', `An order can have at most ${MAX_ORDER_LINES} lines.`);
  }

  const byId = new Map(catalog.map((m) => [m.id, m]));
  const items: OrderItemSnapshot[] = requested.map((line) => {
    if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > MAX_QTY_PER_LINE) {
      throw new OrderValidationError('INVALID_QTY', `Quantities must be between 1 and ${MAX_QTY_PER_LINE}.`);
    }
    const item = byId.get(line.menuItemId);
    if (!item) throw new OrderValidationError('ITEM_NOT_FOUND', 'One of the items is no longer on the menu.');
    if (item.availability !== 'in_stock') throw new OrderValidationError('ITEM_UNAVAILABLE', `"${item.name}" is sold out right now.`);

    let unitPrice = item.price;
    let variant: OrderItemSnapshot['variant'];
    if (line.variantId) {
      const found = (item.variants ?? []).find((v) => v.id === line.variantId);
      if (!found) throw new OrderValidationError('VARIANT_NOT_FOUND', `That size of "${item.name}" is no longer available.`);
      unitPrice = found.price;
      variant = { id: found.id, name: found.name, price: found.price };
    }
    const addons = [...new Set(line.addonIds ?? [])].map((addonId) => {
      const found = (item.addons ?? []).find((a) => a.id === addonId);
      if (!found) throw new OrderValidationError('ADDON_NOT_FOUND', `An add-on for "${item.name}" is no longer available.`);
      return { id: found.id, name: found.name, price: found.price };
    });
    const perUnit = unitPrice + addons.reduce((sum, a) => sum + a.price, 0);
    return {
      menuItemId: item.id,
      categoryId: item.categoryId,
      name: item.name,
      qty: line.qty,
      unitPrice,
      ...(variant ? { variant } : {}),
      ...(addons.length ? { addons } : {}),
      lineTotal: roundMoney(perUnit * line.qty),
    };
  });

  const subtotal = roundMoney(items.reduce((sum, i) => sum + i.lineTotal, 0));
  const now = opts.now ?? new Date();
  const timeZone = opts.timeZone ?? DEFAULT_RESTAURANT_TIME_ZONE;
  const lines = items.map((i) => ({ menuItemId: i.menuItemId, categoryId: i.categoryId, lineTotal: i.lineTotal }));
  const isDelivery = opts.orderType === 'delivery';
  const rule = opts.settings.delivery;

  if (isDelivery && subtotal < rule.minOrder) {
    throw new OrderValidationError('MIN_ORDER_NOT_MET', `The minimum for delivery is ₹${rule.minOrder}.`);
  }

  const evaluate = (offer: Offer) => {
    const provisionalFee = isDelivery ? deliveryFeeFor(rule, subtotal) : 0;
    const result = computeOfferDiscount(offer, { lines, deliveryFee: provisionalFee, now, timeZone });
    return { offer, ...result, saving: result.discount + result.deliveryDiscount };
  };

  let chosen: ReturnType<typeof evaluate> | undefined;
  if (opts.offer) {
    const result = evaluate(opts.offer);
    if (result.saving <= 0) {
      const why = result.reason === 'below_min_order'
        ? `This code needs an order of ₹${opts.offer.minOrderValue} or more.`
        : result.reason === 'not_live' ? "This code isn't valid right now." : "This code doesn't apply to these items.";
      throw new OrderValidationError('OFFER_NOT_APPLICABLE', why);
    }
    chosen = result;
  } else {
    for (const offer of opts.autoOffers ?? []) {
      if (offer.code || !isOfferLive(offer, now, timeZone)) continue;
      if (offer.reward.kind === 'free_delivery' && !isDelivery) continue;
      const result = evaluate(offer);
      if (result.saving > 0 && (!chosen || result.saving > chosen.saving)) chosen = result;
    }
  }

  const discount = roundMoney(Math.min(chosen?.discount ?? 0, subtotal));
  const afterDiscount = roundMoney(subtotal - discount);
  const deliveryFee = isDelivery ? deliveryFeeFor(rule, afterDiscount) : 0;
  const deliveryDiscount = roundMoney(Math.min(chosen?.deliveryDiscount ?? 0, deliveryFee));
  const tax = roundMoney(afterDiscount * (Math.max(0, opts.settings.taxRatePercent) / 100));
  const total = roundMoney(afterDiscount + tax + deliveryFee - deliveryDiscount);

  return {
    items,
    totals: { subtotal, discount, deliveryFee, deliveryDiscount, tax, total },
    ...(chosen && discount + deliveryDiscount > 0
      ? {
        offer: {
          offerId: chosen.offer.id,
          title: chosen.offer.title,
          ...(chosen.offer.code ? { code: chosen.offer.code } : {}),
          discount,
          deliveryDiscount,
        },
      }
      : {}),
  };
}

/** Strip the order down to what the customer's tracking page may see. */
export function toPublicOrder(order: Order): PublicOrder {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    orderType: order.orderType,
    items: order.items,
    totals: order.totals,
    ...(order.offer ? { offer: order.offer } : {}),
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    createdAt: order.createdAt,
    statusHistory: order.statusHistory.map(({ status, at }) => ({ status, at })),
  };
}

/** Restaurant slug: lowercase letters, digits and single hyphens, 3-48 chars. */
export function isValidRestaurantSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,47}$/.test(slug);
}

/** A slug suggestion from a restaurant name ("Bawarchi's Kitchen!" -> "bawarchis-kitchen"). */
export function slugifyRestaurantName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
}
