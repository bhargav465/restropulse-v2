/**
 * DEMO MODE payment flow: place (PENDING_PAYMENT) → createIntent → verify →
 * RECEIVED, all locally with zero backend and zero razorpay.com requests.
 *
 * The api-client demo switch resolves at module load, so each test stubs the
 * env first, resets the module registry, then re-imports ../api dynamically.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const importApi = () => import('../api');

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('demo payment flow', () => {
  it('place → intent → verify captures the order without any network call', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    const fetchMock = vi.fn(() => { throw new Error('demo mode must not fetch'); });
    vi.stubGlobal('fetch', fetchMock);

    const { customerAuthAPI, orderAPI, paymentAPI } = await importApi();

    await customerAuthAPI.login('demo', 'payer@example.com', 'anything');

    const order = await orderAPI.place(
      'demo',
      { items: [{ menuItemId: 'demo-mi-01', qty: 1 }], orderType: 'pickup' },
      'pay-idem-1',
    );
    expect(order.status).toBe('PENDING_PAYMENT');
    expect(order.statusHistory).toHaveLength(1);
    expect(order.statusHistory[0].status).toBe('PENDING_PAYMENT');

    const intent = await paymentAPI.createIntent('demo', order.id);
    expect(intent.keyId).toBe('rzp_test_demo');
    expect(intent.currency).toBe('INR');
    expect(intent.amount).toBe(Math.round(order.totals.total * 100));

    const paid = await paymentAPI.verify('demo', {
      orderId: order.id,
      razorpayPaymentId: 'demo_pay',
      razorpayOrderId: intent.providerOrderId,
      razorpaySignature: 'demo_sig',
    });
    expect(paid.status).toBe('RECEIVED');
    expect(paid.statusHistory.some((h) => h.status === 'RECEIVED')).toBe(true);
    expect(paid.statusHistory[paid.statusHistory.length - 1].note).toContain('[DEMO]');

    // Persisted: reloading the order reflects the captured status.
    const reloaded = await orderAPI.get('demo', order.id);
    expect(reloaded.status).toBe('RECEIVED');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('createIntent requires an authenticated session', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    const { orderAPI, customerAuthAPI, paymentAPI } = await importApi();

    await customerAuthAPI.login('demo', 'payer@example.com', 'anything');
    const order = await orderAPI.place(
      'demo',
      { items: [{ menuItemId: 'demo-mi-01', qty: 1 }], orderType: 'pickup' },
      'pay-idem-2',
    );
    customerAuthAPI.logout('demo');

    await expect(paymentAPI.createIntent('demo', order.id)).rejects.toMatchObject({ status: 401 });
  });

  it('unpaid orders do not advance through the kitchen timeline', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    const { orderAPI, customerAuthAPI } = await importApi();

    await customerAuthAPI.login('demo', 'payer@example.com', 'anything');
    const order = await orderAPI.place(
      'demo',
      { items: [{ menuItemId: 'demo-mi-01', qty: 1 }], orderType: 'pickup' },
      'pay-idem-3',
    );

    const tracked = await orderAPI.track('demo', order.id);
    expect(tracked.status).toBe('PENDING_PAYMENT');
  });
});
