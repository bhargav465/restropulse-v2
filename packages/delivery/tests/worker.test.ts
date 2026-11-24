import { describe, expect, it, vi } from 'vitest';
import type { ShipmentEvent } from '@restropulse/shared';
import type { DeliveryProvider } from '../src/index';
import {
  applyShipmentEvents,
  backoffMs,
  createDeliveryRegistry,
  createMockProvider,
  createSelfProvider,
  DeliveryProviderError,
  pollLiveShipments,
  processDueJobs,
  runJob,
  syncOrderWithShipment,
} from '../src/index';
import { makeOrder, makeRestaurant, MemoryStore } from './memory-store';

const T0 = Date.parse('2026-11-24T10:00:00.000Z');

function setup(opts: { order?: Parameters<typeof makeOrder>[0]; restaurant?: Parameters<typeof makeRestaurant>[0]; providers?: DeliveryProvider[] } = {}) {
  let clock = T0;
  const store = new MemoryStore(makeOrder(opts.order), makeRestaurant(opts.restaurant));
  const registry = createDeliveryRegistry(opts.providers ?? [createSelfProvider(), createMockProvider({ minuteMs: 1000, now: () => new Date(clock) })]);
  const onEvent = vi.fn();
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const deps = { store, registry, now: () => new Date(clock), onEvent, log };
  return { store, registry, deps, onEvent, log, tick: (ms: number) => { clock += ms; } };
}

describe('backoffMs', () => {
  it('doubles from 30s and caps at 15 minutes', () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(0)).toBe(30_000);
    expect(backoffMs(20)).toBe(15 * 60_000);
  });
});

describe('dispatch jobs', () => {
  it('books a rider and records the shipment', async () => {
    const { store, deps, onEvent } = setup();
    await store.enqueueJob({ type: 'dispatch', restaurantId: 'r1', orderId: 'o1', dedupeKey: 'dispatch:o1' });
    expect(await store.enqueueJob({ type: 'dispatch', restaurantId: 'r1', orderId: 'o1', dedupeKey: 'dispatch:o1' })).toBeNull();
    expect(await processDueJobs(deps)).toEqual({ done: 1, retried: 0, failed: 0 });
    expect(store.shipments).toHaveLength(1);
    expect(store.shipments[0]).toMatchObject({ provider: 'mock', status: 'BOOKED', fee: 45, etaMinutes: 30, carrier: 'Mock Rider Co' });
    expect(store.shipments[0].events[0]).toMatchObject({ source: 'dispatcher', note: 'Booked with mock' });
    expect(onEvent).toHaveBeenCalledWith('delivery_dispatched', { restaurantId: 'r1', provider: 'mock', fellBackToSelf: 'false' });
    expect(store.jobs[0].status).toBe('done');
  });

  it('notes the fallback when no partner can take it', async () => {
    const { store, deps } = setup({ order: { address: { line1: 'x', pincode: '000000' } } });
    await store.enqueueJob({ type: 'dispatch', restaurantId: 'r1', orderId: 'o1' });
    await processDueJobs(deps);
    expect(store.shipments[0].provider).toBe('self');
    expect(store.shipments[0].fee).toBeUndefined();
    expect(store.shipments[0].events[0].note).toContain("No partner could take it");
  });

  it('labels own-rider bookings', async () => {
    const { store, deps } = setup({ restaurant: { deliverySettings: { providers: ['self'] } } });
    expect(await runJob({ id: 'j', type: 'dispatch', restaurantId: 'r1', orderId: 'o1', status: 'running', attempts: 0, nextRunAt: new Date(), createdAt: '', updatedAt: '' }, deps)).toBe('booked');
    expect(store.shipments[0].events[0].note).toBe('Your own riders');
  });

  it.each([
    ['order_missing', (s: MemoryStore) => s.orders.clear()],
    ['not_needed', (s: MemoryStore) => s.orders.set('o1', makeOrder({ status: 'CANCELLED' }))],
    ['not_needed', (s: MemoryStore) => s.orders.set('o1', makeOrder({ orderType: 'pickup' }))],
    ['restaurant_missing', (s: MemoryStore) => s.restaurants.clear()],
  ])('skips with %s', async (outcome, arrange) => {
    const { store, deps } = setup();
    arrange(store);
    const job = (await store.enqueueJob({ type: 'dispatch', restaurantId: 'r1', orderId: 'o1' }))!;
    expect(await runJob(job, deps)).toBe(outcome);
  });

  it('does not double-book a live shipment but rebooks after a cancelled one', async () => {
    const { store, deps } = setup();
    const job = (await store.enqueueJob({ type: 'dispatch', restaurantId: 'r1', orderId: 'o1' }))!;
    await runJob(job, deps);
    expect(await runJob(job, deps)).toBe('already_booked');
    store.shipments[0].status = 'CANCELLED';
    expect(await runJob(job, deps)).toBe('booked');
    expect(store.shipments).toHaveLength(2);
  });

  it('fails at once when the order has no address', async () => {
    const { store, deps, onEvent } = setup({ order: { address: undefined } });
    await store.enqueueJob({ type: 'dispatch', restaurantId: 'r1', orderId: 'o1' });
    expect(await processDueJobs(deps)).toEqual({ done: 0, retried: 0, failed: 1 });
    expect(store.jobs[0].lastError).toBe('The order has no delivery address.');
    expect(onEvent).toHaveBeenCalledWith('delivery_job_failed', { restaurantId: 'r1', type: 'dispatch' });
  });

  it('fails at once when even own riders are unavailable', async () => {
    const { store, deps } = setup({ providers: [] });
    await store.enqueueJob({ type: 'dispatch', restaurantId: 'r1', orderId: 'o1' });
    expect((await processDueJobs(deps)).failed).toBe(1);
  });

  it('retries with backoff on a passing error, then gives up', async () => {
    const { store, deps, tick } = setup();
    store.insertShipment = async () => { throw new Error('db blip'); };
    await store.enqueueJob({ type: 'dispatch', restaurantId: 'r1', orderId: 'o1' });
    expect(await processDueJobs({ ...deps, maxAttempts: 2 })).toEqual({ done: 0, retried: 1, failed: 0 });
    expect(store.jobs[0]).toMatchObject({ status: 'pending', attempts: 1, lastError: 'db blip' });
    expect(await processDueJobs(deps)).toEqual({ done: 0, retried: 0, failed: 0 }); // not due yet
    tick(30_000);
    expect(await processDueJobs({ ...deps, maxAttempts: 2 })).toEqual({ done: 0, retried: 0, failed: 1 });
  });

  it('retries when a partner throws something unexpected', async () => {
    const odd = { ...createMockProvider(), async quote() { return { provider: 'mock' as const, serviceable: true, fee: 1 }; }, async createShipment(): Promise<never> { throw new Error('x'); } };
    const { store, deps } = setup({ providers: [odd] });
    await store.enqueueJob({ type: 'dispatch', restaurantId: 'r1', orderId: 'o1' });
    const real = deps.registry.get;
    deps.registry.get = ((id: string) => (id === 'self' ? { ...createSelfProvider(), quote: () => { throw new TypeError('boom'); } } : real(id as never))) as never;
    expect((await processDueJobs(deps)).retried).toBe(1);
  });

  it('stops after the per-pass limit and works without a logger', async () => {
    const { store, registry } = setup();
    await store.enqueueJob({ type: 'dispatch', restaurantId: 'r1', orderId: 'o1' });
    await store.enqueueJob({ type: 'dispatch', restaurantId: 'r1', orderId: 'o1' });
    expect((await processDueJobs({ store, registry }, 1)).done).toBe(1);
  });

  it('moves a PREPARING order along when the rider already has the food', async () => {
    const pickedUp: DeliveryProvider = {
      ...createMockProvider(),
      async createShipment() { return { providerShipmentId: 'mock_o1_1', status: 'PICKED_UP' }; },
    };
    const { store, deps } = setup({ order: { status: 'PREPARING' }, providers: [createSelfProvider(), pickedUp] });
    await store.enqueueJob({ type: 'dispatch', restaurantId: 'r1', orderId: 'o1' });
    await processDueJobs(deps);
    expect(store.orders.get('o1')!.status).toBe('OUT_FOR_DELIVERY');
  });
});

describe('cancel jobs', () => {
  async function booked() {
    const s = setup();
    await s.store.enqueueJob({ type: 'dispatch', restaurantId: 'r1', orderId: 'o1' });
    await processDueJobs(s.deps);
    return s;
  }

  it('cancels a booked shipment with its partner', async () => {
    const { store, deps } = await booked();
    const job = (await store.enqueueJob({ type: 'cancel', restaurantId: 'r1', orderId: 'o1', reason: 'Customer called' }))!;
    expect(await runJob(job, deps)).toBe('cancelled');
    expect(store.shipments[0]).toMatchObject({ status: 'CANCELLED', cancelReason: 'Customer called' });
    expect(await runJob(job, deps)).toBe('nothing_to_cancel');
  });

  it('uses a default reason', async () => {
    const { store, deps } = await booked();
    await runJob((await store.enqueueJob({ type: 'cancel', restaurantId: 'r1', orderId: 'o1' }))!, deps);
    expect(store.shipments[0].cancelReason).toBe('Cancelled by the restaurant');
  });

  it('leaves a picked-up shipment alone', async () => {
    const { store, deps } = await booked();
    store.shipments[0].status = 'PICKED_UP';
    expect(await runJob((await store.enqueueJob({ type: 'cancel', restaurantId: 'r1', orderId: 'o1' }))!, deps)).toBe('already_picked_up');
  });

  it('fails when the partner is gone from this server', async () => {
    const { store, deps } = await booked();
    await store.enqueueJob({ type: 'cancel', restaurantId: 'r1', orderId: 'o1' });
    expect((await processDueJobs({ ...deps, registry: createDeliveryRegistry([createSelfProvider()]) })).failed).toBe(1);
  });

  it('retries when the shipment moved meanwhile, and fails on a final partner error', async () => {
    const { store, deps } = await booked();
    store.updateConflicts = 1;
    await store.enqueueJob({ type: 'cancel', restaurantId: 'r1', orderId: 'o1' });
    expect((await processDueJobs(deps)).retried).toBe(1);

    const refusing = { ...createMockProvider(), async cancelShipment() { throw new DeliveryProviderError('too late', false); } };
    const s2 = await booked();
    await s2.store.enqueueJob({ type: 'cancel', restaurantId: 'r1', orderId: 'o1' });
    expect((await processDueJobs({ ...s2.deps, registry: createDeliveryRegistry([createSelfProvider(), refusing]) })).failed).toBe(1);
  });
});

describe('applyShipmentEvents', () => {
  async function withShipment() {
    const s = setup();
    const shipment = await s.store.insertShipment({
      restaurantId: 'r1', orderId: 'o1', provider: 'mock', providerShipmentId: 'mock_o1_x', status: 'BOOKED', events: [],
    });
    return { ...s, shipment };
  }
  const ev = (eventId: string, status: ShipmentEvent['status'], extra: Partial<ShipmentEvent> = {}): ShipmentEvent =>
    ({ eventId, providerShipmentId: 'mock_o1_x', status, at: '2026-11-24T10:05:00.000Z', ...extra });

  it('moves the shipment and the order, and ignores redeliveries and stale events', async () => {
    const { store, shipment } = await withShipment();
    const r = await applyShipmentEvents(store, shipment, [
      ev('a', 'RIDER_ASSIGNED', { rider: { name: 'Ravi' }, etaMinutes: 20 }),
      ev('b', 'PICKED_UP', { trackingUrl: 'https://t.example/1', rider: { phone: '+91' }, note: 'On the bike' }),
      ev('a', 'RIDER_ASSIGNED'),
      ev('c', 'BOOKED'),
    ]);
    expect(r.applied).toBe(2);
    expect(r.shipment).toMatchObject({ status: 'PICKED_UP', rider: { name: 'Ravi', phone: '+91' }, trackingUrl: 'https://t.example/1', etaMinutes: 20 });
    expect(r.order?.status).toBe('OUT_FOR_DELIVERY');
    const again = await applyShipmentEvents(store, r.shipment, [ev('b', 'PICKED_UP')]);
    expect(again.applied).toBe(0);
  });

  it('completes the order on delivery', async () => {
    const { store, shipment } = await withShipment();
    const r = await applyShipmentEvents(store, shipment, [ev('d', 'DELIVERED')]);
    expect(store.orders.get('o1')!.status).toBe('COMPLETED');
    expect(r.order?.statusHistory.map((h) => h.status)).toEqual(['OUT_FOR_DELIVERY', 'COMPLETED']);
  });

  it('records a partner cancellation without touching the order', async () => {
    const { store, shipment } = await withShipment();
    const r = await applyShipmentEvents(store, shipment, [ev('x', 'CANCELLED')]);
    expect(r.shipment).toMatchObject({ status: 'CANCELLED', cancelReason: 'Cancelled by the delivery partner' });
    expect(r.order).toBeUndefined();
    expect(store.orders.get('o1')!.status).toBe('READY');
    const other = await withShipment();
    const r2 = await applyShipmentEvents(other.store, other.shipment, [ev('y', 'CANCELLED', { note: 'No riders nearby' })]);
    expect(r2.shipment.cancelReason).toBe('No riders nearby');
  });

  it('re-reads and retries when another update won the race', async () => {
    const { store, shipment } = await withShipment();
    store.updateConflicts = 1;
    const r = await applyShipmentEvents(store, shipment, [ev('a', 'RIDER_ASSIGNED')]);
    expect(r.applied).toBe(1);
  });

  it('gives up when the shipment vanished or keeps changing', async () => {
    const { store, shipment } = await withShipment();
    store.updateConflicts = 1;
    store.shipments = [];
    expect((await applyShipmentEvents(store, shipment, [ev('a', 'RIDER_ASSIGNED')])).applied).toBe(0);
    const s2 = await withShipment();
    s2.store.updateConflicts = 5;
    expect((await applyShipmentEvents(s2.store, s2.shipment, [ev('a', 'RIDER_ASSIGNED')])).applied).toBe(0);
  });

  it('stops moving the order when it changed meanwhile, and handles a missing order', async () => {
    const { store, shipment } = await withShipment();
    store.moveConflicts = 1;
    await applyShipmentEvents(store, shipment, [ev('d', 'DELIVERED')]);
    expect(store.orders.get('o1')!.status).toBe('READY');
    store.orders.clear();
    expect(await syncOrderWithShipment(store, { ...shipment, status: 'DELIVERED' })).toBeUndefined();
  });
});

describe('pollLiveShipments', () => {
  it('asks polled partners for news and applies it', async () => {
    const { store, deps, tick } = setup();
    await store.enqueueJob({ type: 'dispatch', restaurantId: 'r1', orderId: 'o1' });
    await processDueJobs(deps);
    tick(5_000);
    expect(await pollLiveShipments(deps)).toBe(1);
    expect(store.shipments[0].status).toBe('PICKED_UP');
    expect(store.orders.get('o1')!.status).toBe('OUT_FOR_DELIVERY');
    expect(await pollLiveShipments(deps)).toBe(0);
    tick(20_000);
    await pollLiveShipments(deps);
    expect(store.orders.get('o1')!.status).toBe('COMPLETED');
  });

  it('skips when nothing is polled, and logs a failing partner', async () => {
    const onlySelf = setup({ providers: [createSelfProvider()] });
    expect(await pollLiveShipments(onlySelf.deps)).toBe(0);

    const flaky = { ...createMockProvider(), async track(): Promise<null> { throw new Error('down'); } };
    const quiet = { ...createMockProvider(), async track() { return null; } };
    for (const p of [flaky, quiet]) {
      const s = setup({ providers: [createSelfProvider(), p] });
      await s.store.insertShipment({ restaurantId: 'r1', orderId: 'o1', provider: 'mock', providerShipmentId: 'm', status: 'BOOKED', events: [] });
      expect(await pollLiveShipments(s.deps)).toBe(0);
      expect(await pollLiveShipments({ store: s.store, registry: s.registry })).toBe(0);
      if (p === flaky) expect(s.log.warn).toHaveBeenCalled();
    }
  });
});
