/**
 * Picking a partner and booking the rider (LAUNCH_ARCHITECTURE B4):
 *   1. quote every enabled partner the restaurant listed
 *   2. rank the serviceable ones by the restaurant's strategy
 *   3. book the best; if that fails, the next; if all fail, the restaurant's
 *      own riders (`self`), so no order is ever left without a plan.
 */

import type {
  BookedShipment,
  DeliveryProviderId,
  DeliveryQuote,
  DeliveryStrategy,
  Order,
  QuoteRequest,
  Restaurant,
  RestaurantDeliverySettings,
} from '@restropulse/shared';
import type { DeliveryRegistry } from './registry.js';

export interface DispatchAttempt {
  provider: DeliveryProviderId;
  step: 'quote' | 'book';
  ok: boolean;
  error?: string;
}

export interface DispatchOutcome {
  provider: DeliveryProviderId;
  quote: DeliveryQuote;
  booked: BookedShipment;
  attempts: DispatchAttempt[];
  /** True when every partner failed or none was set up, and own riders took it. */
  fellBackToSelf: boolean;
}

export class DispatchNotPossibleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DispatchNotPossibleError';
  }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/** Serviceable quotes, best first. Ties keep the restaurant's order. */
export function rankQuotes(quotes: DeliveryQuote[], strategy: DeliveryStrategy, preference: DeliveryProviderId[]): DeliveryQuote[] {
  const rank = (q: DeliveryQuote) => {
    const i = preference.indexOf(q.provider);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const eta = (q: DeliveryQuote) => q.etaMinutes ?? Number.MAX_SAFE_INTEGER;
  return quotes
    .filter((q) => q.serviceable)
    .sort((a, b) => {
      if (strategy === 'cheapest' && a.fee !== b.fee) return a.fee - b.fee;
      if (strategy === 'fastest' && eta(a) !== eta(b)) return eta(a) - eta(b);
      return rank(a) - rank(b);
    });
}

/** What partners need to know about an order. Null when it can't be delivered (no address). */
export function buildQuoteRequest(order: Order, restaurant: Restaurant): QuoteRequest | null {
  if (order.orderType !== 'delivery' || !order.address?.line1) return null;
  const r = restaurant as Restaurant & { phone?: string; address?: string | { line1?: string; city?: string; pincode?: string } };
  const pickupAddress = typeof r.address === 'string'
    ? { line1: r.address }
    : r.address?.line1 ? { line1: r.address.line1, ...(r.address.city ? { city: r.address.city } : {}), ...(r.address.pincode ? { pincode: r.address.pincode } : {}) } : undefined;
  return {
    restaurantId: order.restaurantId,
    orderId: order.id,
    orderNumber: order.orderNumber,
    pickup: { name: restaurant.name ?? 'Restaurant', ...(r.phone ? { phone: r.phone } : {}), ...(pickupAddress ? { address: pickupAddress } : {}) },
    drop: { name: order.customerName, phone: order.customerPhone, address: order.address },
    orderValue: order.totals.total,
    collectCash: order.paymentMethod === 'cash' && order.paymentStatus !== 'paid',
  };
}

export async function dispatchOrder(
  req: QuoteRequest,
  settings: RestaurantDeliverySettings,
  registry: DeliveryRegistry,
): Promise<DispatchOutcome> {
  const attempts: DispatchAttempt[] = [];
  const partners = settings.providers.filter((id) => id !== 'self' && registry.has(id));

  const quoted = await Promise.all(partners.map(async (id) => {
    try {
      const q = await registry.get(id)!.quote(req);
      attempts.push({ provider: id, step: 'quote', ok: q.serviceable, ...(q.serviceable ? {} : { error: q.reason ?? 'Not serviceable' }) });
      return { ...q, provider: id };
    } catch (err) {
      attempts.push({ provider: id, step: 'quote', ok: false, error: errorText(err) });
      return null;
    }
  }));

  for (const quote of rankQuotes(quoted.filter((q): q is DeliveryQuote => q !== null), settings.strategy, settings.providers)) {
    try {
      const booked = await registry.get(quote.provider)!.createShipment(req, quote);
      attempts.push({ provider: quote.provider, step: 'book', ok: true });
      return { provider: quote.provider, quote, booked, attempts, fellBackToSelf: false };
    } catch (err) {
      attempts.push({ provider: quote.provider, step: 'book', ok: false, error: errorText(err) });
    }
  }

  const self = registry.get('self');
  if (!self) throw new DispatchNotPossibleError('No delivery partner could take this order and own riders are not available.');
  const quote = await self.quote(req);
  const booked = await self.createShipment(req, quote);
  attempts.push({ provider: 'self', step: 'book', ok: true });
  return { provider: 'self', quote, booked, attempts, fellBackToSelf: partners.length > 0 };
}
