import { describe, expect, it } from 'vitest';
import type { DeliveryQuote, QuoteRequest } from '@restropulse/shared';
import { resolveDeliverySettings } from '@restropulse/shared';
import type { DeliveryProvider } from '../src/index';
import { buildQuoteRequest, createDeliveryRegistry, createMockProvider, createSelfProvider, dispatchOrder, DispatchNotPossibleError, rankQuotes } from '../src/index';
import { makeOrder, makeRestaurant } from './memory-store';

const q = (provider: DeliveryQuote['provider'], fee: number, etaMinutes?: number, serviceable = true): DeliveryQuote =>
  ({ provider, fee, serviceable, ...(etaMinutes !== undefined ? { etaMinutes } : {}) });

function fake(id: 'rapido' | 'shadowfax', over: Partial<DeliveryProvider> = {}): DeliveryProvider {
  return {
    ...createMockProvider(),
    id,
    info: { id, label: id, kind: 'partner', webhooks: true },
    async quote() { return q(id, id === 'rapido' ? 60 : 40, id === 'rapido' ? 20 : 35); },
    async createShipment() { return { providerShipmentId: `${id}-1`, status: 'BOOKED' }; },
    ...over,
  };
}

describe('rankQuotes', () => {
  const quotes = [q('mock', 50, 30), q('rapido', 40, 40), q('shadowfax', 40, 20), q('middleware', 10, 5, false)];
  const pref = ['mock', 'rapido', 'shadowfax'] as const;

  it('drops partners that cannot deliver', () => {
    expect(rankQuotes(quotes, 'preferred', [...pref]).map((x) => x.provider)).toEqual(['mock', 'rapido', 'shadowfax']);
  });
  it('cheapest breaks ties by preference', () => {
    expect(rankQuotes(quotes, 'cheapest', [...pref]).map((x) => x.provider)).toEqual(['rapido', 'shadowfax', 'mock']);
  });
  it('fastest puts missing ETAs last', () => {
    expect(rankQuotes([q('mock', 1), ...quotes], 'fastest', [...pref]).map((x) => x.provider)).toEqual(['shadowfax', 'mock', 'rapido', 'mock']);
  });
  it('partners missing from the list go last', () => {
    expect(rankQuotes([q('rapido', 1), q('mock', 1)], 'preferred', ['mock']).map((x) => x.provider)).toEqual(['mock', 'rapido']);
  });
});

describe('buildQuoteRequest', () => {
  it('carries pickup, drop and whether to collect cash', () => {
    const r = buildQuoteRequest(
      makeOrder({ paymentMethod: 'cash' }),
      makeRestaurant({ phone: '+914400', address: { line1: '1 Food St', city: 'Chennai', pincode: '600001' } } as never),
    )!;
    expect(r.pickup).toEqual({ name: '[SAMPLE] Spice Route', phone: '+914400', address: { line1: '1 Food St', city: 'Chennai', pincode: '600001' } });
    expect(r.drop.address.line1).toBe('12 MG Road');
    expect(r.collectCash).toBe(true);
    expect(r.orderValue).toBe(450);
  });
  it('accepts a plain string address and a missing name', () => {
    const r = buildQuoteRequest(makeOrder(), makeRestaurant({ name: undefined, address: '1 Food St' } as never))!;
    expect(r.pickup).toEqual({ name: 'Restaurant', address: { line1: '1 Food St' } });
    expect(buildQuoteRequest(makeOrder(), makeRestaurant({ address: { city: 'x' } } as never))!.pickup.address).toBeUndefined();
    expect(buildQuoteRequest(makeOrder(), makeRestaurant({ address: { line1: 'a' } } as never))!.pickup.address).toEqual({ line1: 'a' });
  });
  it('is null for pickup orders or orders without an address', () => {
    expect(buildQuoteRequest(makeOrder({ orderType: 'pickup' }), makeRestaurant())).toBeNull();
    expect(buildQuoteRequest(makeOrder({ address: undefined }), makeRestaurant())).toBeNull();
  });
});

describe('dispatchOrder', () => {
  const req = buildQuoteRequest(makeOrder(), makeRestaurant()) as QuoteRequest;
  const settings = (over = {}) => resolveDeliverySettings({ dispatchEnabled: true, providers: ['rapido', 'shadowfax', 'self'], ...over });

  it('books the preferred partner', async () => {
    const out = await dispatchOrder(req, settings(), createDeliveryRegistry([createSelfProvider(), fake('rapido'), fake('shadowfax')]));
    expect(out.provider).toBe('rapido');
    expect(out.fellBackToSelf).toBe(false);
  });

  it('books the cheapest when asked', async () => {
    const out = await dispatchOrder(req, settings({ strategy: 'cheapest' }), createDeliveryRegistry([createSelfProvider(), fake('rapido'), fake('shadowfax')]));
    expect(out.provider).toBe('shadowfax');
  });

  it('tries the next partner when booking fails, and records why', async () => {
    const broken = fake('rapido', { async createShipment() { throw new Error('rapido is down'); } });
    const out = await dispatchOrder(req, settings(), createDeliveryRegistry([createSelfProvider(), broken, fake('shadowfax')]));
    expect(out.provider).toBe('shadowfax');
    expect(out.attempts).toContainEqual({ provider: 'rapido', step: 'book', ok: false, error: 'rapido is down' });
  });

  it('falls back to own riders when every partner fails', async () => {
    const noQuote = fake('rapido', { async quote() { throw 'timeout'; } });
    const noArea = fake('shadowfax', { async quote() { return q('shadowfax', 0, undefined, false); } });
    const out = await dispatchOrder(req, settings(), createDeliveryRegistry([createSelfProvider(), noQuote, noArea]));
    expect(out.provider).toBe('self');
    expect(out.fellBackToSelf).toBe(true);
    expect(out.attempts.map((a) => a.error)).toEqual(['timeout', 'Not serviceable', undefined]);
  });

  it('uses own riders without calling it a fallback when no partner is listed', async () => {
    const out = await dispatchOrder(req, settings({ providers: ['self', 'middleware'] }), createDeliveryRegistry([createSelfProvider()]));
    expect(out).toMatchObject({ provider: 'self', fellBackToSelf: false });
  });

  it('gives up only when own riders are missing too', async () => {
    await expect(dispatchOrder(req, settings(), createDeliveryRegistry([]))).rejects.toBeInstanceOf(DispatchNotPossibleError);
  });
});
