import { describe, expect, it, vi } from 'vitest';
import { createDeliveryRegistry, createMockProvider, createSelfProvider } from '@restropulse/delivery';
import type { DeliveryStore } from '@restropulse/shared';
import { createDispatchLoop } from '../src/loop';
import { loadWorkerConfig } from '../src/config';

function fakeStore(over: Partial<DeliveryStore> = {}): DeliveryStore {
  return {
    enqueueJob: vi.fn(), claimDueJob: vi.fn(async () => null), completeJob: vi.fn(), retryJob: vi.fn(), failJob: vi.fn(),
    findRestaurant: vi.fn(), findOrder: vi.fn(), moveOrder: vi.fn(), insertShipment: vi.fn(), findShipmentForOrder: vi.fn(),
    findShipmentByProviderId: vi.fn(), updateShipment: vi.fn(), findLiveShipments: vi.fn(async () => []),
    ...over,
  } as DeliveryStore;
}

const registry = createDeliveryRegistry([createSelfProvider(), createMockProvider()]);
const log = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('dispatch loop', () => {
  it('drains jobs every pass and polls partners on its own schedule', async () => {
    let clock = 0;
    const store = fakeStore();
    const loop = createDispatchLoop({ store, registry }, { intervalMs: 1000, pollEveryMs: 10_000, now: () => clock });
    clock = 10_000;
    await loop.tick();
    await loop.tick();
    expect(store.claimDueJob).toHaveBeenCalledTimes(2);
    expect(store.findLiveShipments).toHaveBeenCalledTimes(1);
    clock = 20_000;
    await loop.tick();
    expect(store.findLiveShipments).toHaveBeenCalledTimes(2);
  });

  it('logs passes that did something, and survives a failing pass', async () => {
    const l = log();
    let calls = 0;
    const job = { id: 'j1', type: 'dispatch', restaurantId: 'r1', orderId: 'o1', status: 'running', attempts: 0, nextRunAt: '', createdAt: '', updatedAt: '' } as const;
    const store = fakeStore({
      claimDueJob: vi.fn(async () => (calls++ === 0 ? job : null)),
      findOrder: vi.fn(async () => null),
      findLiveShipments: vi.fn(async () => [{ id: 's1', restaurantId: 'r1', orderId: 'o1', provider: 'mock', providerShipmentId: `mock_o1_${(0).toString(36)}`, status: 'BOOKED', events: [], createdAt: '', updatedAt: '' }]),
      updateShipment: vi.fn(async (_id, _e, patch) => ({ id: 's1', restaurantId: 'r1', orderId: 'o1', provider: 'mock', providerShipmentId: 'x', status: patch.status!, events: patch.events!, createdAt: '', updatedAt: '' })),
    });
    const loop = createDispatchLoop({ store, registry, log: l }, { intervalMs: 1000, pollEveryMs: 0 });
    await loop.tick();
    expect(l.info).toHaveBeenCalledWith({ done: 1, retried: 0, failed: 0 }, 'dispatch pass');
    expect(l.info).toHaveBeenCalledWith({ changed: 1 }, 'shipments updated from partners');

    const broken = createDispatchLoop({ store: fakeStore({ claimDueJob: vi.fn(async () => { throw new Error('db down'); }) }), registry, log: l }, { intervalMs: 1000, pollEveryMs: 0 });
    await broken.tick();
    expect(l.error).toHaveBeenCalledWith({ err: 'db down' }, 'dispatch pass failed');
    const brokenQuiet = createDispatchLoop({ store: fakeStore({ claimDueJob: vi.fn(async () => { throw 'odd'; }) }), registry }, { intervalMs: 1000, pollEveryMs: 0 });
    await expect(brokenQuiet.tick()).resolves.toBeUndefined();
  });

  it('never runs two passes at once', async () => {
    let release!: () => void;
    const store = fakeStore({ claimDueJob: vi.fn(() => new Promise<null>((r) => { release = () => r(null); })) });
    const loop = createDispatchLoop({ store, registry }, { intervalMs: 1000, pollEveryMs: 1e9 });
    const a = loop.tick();
    const b = loop.tick();
    release();
    await Promise.all([a, b]);
    expect(store.claimDueJob).toHaveBeenCalledTimes(1);
  });

  it('schedules itself after start and stops cleanly', async () => {
    const timers: Array<() => void> = [];
    const setTimer = vi.fn((fn: () => void) => { timers.push(fn); return timers.length; });
    const clearTimer = vi.fn();
    const store = fakeStore();
    const loop = createDispatchLoop({ store, registry }, { intervalMs: 1000, pollEveryMs: 1e9, setTimer, clearTimer });
    loop.start();
    loop.start();
    expect(setTimer).toHaveBeenCalledTimes(1);
    timers[0]();
    await vi.waitFor(() => expect(setTimer).toHaveBeenCalledTimes(2));
    expect(store.claimDueJob).toHaveBeenCalledTimes(1);
    await loop.stop();
    expect(clearTimer).toHaveBeenCalledWith(2);
    timers[1]();
    await new Promise((r) => setTimeout(r, 0));
    expect(setTimer).toHaveBeenCalledTimes(2);
    await loop.stop();
  });

  it('waits for the pass in flight when stopping, with real timers by default', async () => {
    let release!: () => void;
    const store = fakeStore({ claimDueJob: vi.fn(() => new Promise<null>((r) => { release = () => r(null); })) });
    const loop = createDispatchLoop({ store, registry }, { intervalMs: 5, pollEveryMs: 1e9 });
    loop.start();
    await vi.waitFor(() => expect(store.claimDueJob).toHaveBeenCalled());
    let stopped = false;
    const stopping = loop.stop().then(() => { stopped = true; });
    await new Promise((r) => setTimeout(r, 0));
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(stopped).toBe(true);
  });
});

describe('loadWorkerConfig', () => {
  it('needs the database and has sensible defaults', () => {
    expect(() => loadWorkerConfig({})).toThrow('MONGODB_URI is required.');
    expect(loadWorkerConfig({ MONGODB_URI: 'mongodb://x' })).toEqual({ intervalMs: 5000, pollEveryMs: 30000 });
    expect(loadWorkerConfig({ MONGODB_URI: 'mongodb://x', DISPATCH_INTERVAL_MS: '2000', DISPATCH_POLL_MS: '' })).toEqual({ intervalMs: 2000, pollEveryMs: 30000 });
  });
  it('rejects silly intervals', () => {
    expect(() => loadWorkerConfig({ MONGODB_URI: 'x', DISPATCH_INTERVAL_MS: '10' })).toThrow('DISPATCH_INTERVAL_MS');
    expect(() => loadWorkerConfig({ MONGODB_URI: 'x', DISPATCH_POLL_MS: 'soon' })).toThrow('DISPATCH_POLL_MS');
  });
  it('reads process.env by default', () => {
    const prev = process.env.MONGODB_URI;
    process.env.MONGODB_URI = 'mongodb://env';
    expect(loadWorkerConfig().intervalMs).toBe(5000);
    if (prev === undefined) delete process.env.MONGODB_URI; else process.env.MONGODB_URI = prev;
  });
});
