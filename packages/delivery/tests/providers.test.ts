import { describe, expect, it } from 'vitest';
import { buildQuoteRequest, buildDeliveryRegistry, createDeliveryRegistry, createMockProvider, createSelfProvider, mockSignature, MOCK_FEE } from '../src/index';
import { makeOrder, makeRestaurant } from './memory-store';

const req = buildQuoteRequest(makeOrder(), makeRestaurant())!;

describe('self provider', () => {
  it('always takes the order for free and needs no network', async () => {
    const self = createSelfProvider(() => new Date(1_700_000_000_000));
    const q = await self.quote(req);
    expect(q).toEqual({ provider: 'self', serviceable: true, fee: 0 });
    const booked = await self.createShipment(req, q);
    expect(booked.providerShipmentId).toBe(`self_o1_${(1_700_000_000_000).toString(36)}`);
    expect(booked.status).toBe('BOOKED');
    await expect(self.cancelShipment('x', 'y')).resolves.toBeUndefined();
    expect(await self.track('x')).toBeNull();
    expect(self.verifyWebhook({ headers: {}, rawBody: Buffer.from('') })).toBe(false);
    expect(self.parseWebhook(Buffer.from('{}'))).toEqual([]);
  });

  it('uses the real clock by default', async () => {
    const booked = await createSelfProvider().createShipment(req, { provider: 'self', serviceable: true, fee: 0 });
    expect(booked.providerShipmentId).toMatch(/^self_o1_[0-9a-z]+$/);
  });
});

describe('mock provider', () => {
  const t0 = Date.parse('2026-11-24T10:00:00.000Z');
  let clock = t0;
  const mock = createMockProvider({ webhookSecret: 'shh', minuteMs: 1000, now: () => new Date(clock) });

  it('quotes a fixed fee, and refuses pincode 000000', async () => {
    expect(await mock.quote(req)).toMatchObject({ serviceable: true, fee: MOCK_FEE, etaMinutes: 30 });
    const far = { ...req, drop: { ...req.drop, address: { line1: 'x', pincode: '000000' } } };
    expect(await mock.quote(far)).toMatchObject({ serviceable: false, reason: 'Outside the test area' });
  });

  it('follows its timeline after booking', async () => {
    clock = t0;
    const booked = await mock.createShipment(req, await mock.quote(req));
    expect(booked).toMatchObject({ status: 'BOOKED', fee: MOCK_FEE, etaMinutes: 30, carrier: 'Mock Rider Co' });
    const at = async (s: number) => {
      clock = t0 + s * 1000;
      return mock.track(booked.providerShipmentId);
    };
    expect((await at(0))?.status).toBe('BOOKED');
    expect(await at(2)).toMatchObject({ status: 'RIDER_ASSIGNED', rider: { name: 'Test Rider' }, etaMinutes: 13 });
    expect((await at(4))?.status).toBe('PICKED_UP');
    expect((await at(7))?.status).toBe('IN_TRANSIT');
    const done = await at(20);
    expect(done?.status).toBe('DELIVERED');
    expect(done?.etaMinutes).toBeUndefined();
    expect(done?.eventId).toBe(`${booked.providerShipmentId}:DELIVERED`);
    expect(await mock.track('someone-else')).toBeNull();
    await expect(mock.cancelShipment(booked.providerShipmentId, 'x')).resolves.toBeUndefined();
  });

  it('books without an ETA when the quote had none', async () => {
    const b = await mock.createShipment(req, { provider: 'mock', serviceable: true, fee: 10 });
    expect(b.etaMinutes).toBeUndefined();
  });

  it('verifies signed webhooks only', () => {
    const raw = Buffer.from(JSON.stringify({ events: [] }));
    expect(mock.verifyWebhook({ headers: { 'x-mock-signature': mockSignature('shh', raw) }, rawBody: raw })).toBe(true);
    expect(mock.verifyWebhook({ headers: { 'x-mock-signature': mockSignature('nope', raw) }, rawBody: raw })).toBe(false);
    expect(mock.verifyWebhook({ headers: { 'x-mock-signature': 'short' }, rawBody: raw })).toBe(false);
    expect(mock.verifyWebhook({ headers: {}, rawBody: raw })).toBe(false);
    const unsigned = createMockProvider();
    expect(unsigned.verifyWebhook({ headers: { 'x-mock-signature': mockSignature('shh', raw) }, rawBody: raw })).toBe(false);
  });

  it('parses webhook events and drops anything malformed', () => {
    clock = t0;
    const raw = Buffer.from(JSON.stringify({
      events: [
        { id: 'e1', shipmentId: 'mock_o1_x', status: 'PICKED_UP', at: '2026-11-24T10:05:00Z', riderName: 'Ravi' },
        { id: 'e2', shipmentId: 'mock_o1_x', status: 'DELIVERED' },
        { id: 'e3', shipmentId: 'mock_o1_x', status: 'TELEPORTED' },
        { shipmentId: 'mock_o1_x', status: 'DELIVERED' },
        null,
      ],
    }));
    expect(mock.parseWebhook(raw)).toEqual([
      { eventId: 'e1', providerShipmentId: 'mock_o1_x', status: 'PICKED_UP', at: '2026-11-24T10:05:00.000Z', rider: { name: 'Ravi' } },
      { eventId: 'e2', providerShipmentId: 'mock_o1_x', status: 'DELIVERED', at: new Date(t0).toISOString() },
    ]);
    expect(mock.parseWebhook(Buffer.from('not json'))).toEqual([]);
    expect(mock.parseWebhook(Buffer.from('{"events":{}}'))).toEqual([]);
  });
});

describe('registry', () => {
  it('has own riders always and the mock only when switched on', () => {
    expect(buildDeliveryRegistry({}).list().map((p) => p.id)).toEqual(['self']);
    const r = buildDeliveryRegistry({ DELIVERY_MOCK_ENABLED: 'true', MOCK_DELIVERY_WEBHOOK_SECRET: 's', DELIVERY_MOCK_MINUTE_MS: '500' });
    expect(r.list().map((p) => p.id)).toEqual(['self', 'mock']);
    expect(r.has('mock')).toBe(true);
    expect(r.get('rapido')).toBeUndefined();
    expect(buildDeliveryRegistry({ DELIVERY_MOCK_ENABLED: 'true', DELIVERY_MOCK_MINUTE_MS: 'abc' }).has('mock')).toBe(true);
  });

  it('reads process.env by default', () => {
    expect(buildDeliveryRegistry().has('self')).toBe(true);
    expect(createDeliveryRegistry([]).list()).toEqual([]);
  });
});
