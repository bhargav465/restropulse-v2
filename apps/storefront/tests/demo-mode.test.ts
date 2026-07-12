/**
 * DEMO MODE (VITE_DEMO_MODE=true): api-client switch + local demo order flow.
 *
 * The switch in api.ts is resolved at module load, so every test stubs the
 * env first, resets the module registry, and re-imports ../api dynamically.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const importApi = () => import('../api');

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('api client switch', () => {
  it('serves fixture config + menu without any network call when the flag is on', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    const fetchMock = vi.fn(() => { throw new Error('demo mode must not fetch'); });
    vi.stubGlobal('fetch', fetchMock);

    const { storefrontAPI } = await importApi();

    const config = await storefrontAPI.getConfig('demo');
    expect(config.restaurant.slug).toBe('demo');
    expect(config.restaurant.name).toContain('[SAMPLE]');
    expect(config.content?.reservations?.maxPartySize).toBe(10);

    const menu = await storefrontAPI.getMenu('demo');
    const ids = menu.flatMap((c) => c.items.map((i) => i.id));
    expect(menu).toHaveLength(4);
    expect(ids).toContain('demo-mi-01');
    expect(ids).not.toContain('demo-mi-09'); // hidden seed item is excluded
    expect(menu[0].items.find((i) => i.id === 'demo-mi-04')?.soldOut).toBe(true);

    // Unknown slugs still 404 so the not-found gate works in demo mode too.
    await expect(storefrontAPI.getConfig('other')).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the real fetch-backed client when the flag is off', async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          restaurant: { id: 'r1', name: 'Real Place', slug: 'real', storeOpen: true, ordering: null },
          content: null,
          storeOpen: true,
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { storefrontAPI } = await importApi();
    const config = await storefrontAPI.getConfig('real');

    expect(config.restaurant.name).toBe('Real Place');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/storefront/real/config');
  });
});

describe('demo order flow', () => {
  it('login → place → localStorage persistence → history + tracking', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    const fetchMock = vi.fn(() => { throw new Error('demo mode must not fetch'); });
    vi.stubGlobal('fetch', fetchMock);

    const { customerAuthAPI, orderAPI, paymentAPI } = await importApi();

    // Simulated local session
    const { customer } = await customerAuthAPI.login('demo', 'viewer@example.com', 'anything');
    expect(customer.email).toBe('viewer@example.com');
    expect(localStorage.getItem('sf_token_demo')).toMatch(/^demo-token-/);

    // Place an order: 2x Crispy Corn Chaat (180) pickup → subtotal 360, 5% tax 18
    const order = await orderAPI.place(
      'demo',
      { items: [{ menuItemId: 'demo-mi-01', qty: 2 }], orderType: 'pickup' },
      'idem-key-1',
    );
    expect(order.orderNumber).toMatch(/^ORD-/);
    expect(order.totals).toMatchObject({ subtotal: 360, tax: 18, deliveryFee: 0, total: 378 });
    // Orders now start awaiting payment (mirrors the real Razorpay flow).
    expect(order.status).toBe('PENDING_PAYMENT');

    // Stored locally so account history + tracking work without a backend
    const stored = JSON.parse(localStorage.getItem('sf_demo_orders_demo') ?? '[]');
    expect(stored).toHaveLength(1);

    // Unpaid orders don't advance through the kitchen timeline yet.
    const trackingBeforePay = await orderAPI.track('demo', order.id);
    expect(trackingBeforePay.status).toBe('PENDING_PAYMENT');

    // Simulate payment: intent (fake processing) → verify → order confirmed.
    const intent = await paymentAPI.createIntent('demo', order.id);
    expect(intent.providerOrderId).toMatch(/^demo_rzp_/);
    expect(intent.amount).toBe(37800); // paise
    const paid = await paymentAPI.verify('demo', {
      orderId: order.id,
      razorpayPaymentId: 'demo_pay',
      razorpayOrderId: intent.providerOrderId,
      razorpaySignature: 'demo_sig',
    });
    expect(paid.status).toBe('RECEIVED');

    const history = await orderAPI.list('demo');
    expect(history.map((o) => o.id)).toContain(order.id);

    const tracking = await orderAPI.track('demo', order.id);
    expect(tracking.orderNumber).toBe(order.orderNumber);
    expect(tracking.status).toBe('RECEIVED');
    expect(tracking.statusHistory.length).toBeGreaterThan(0);

    // Idempotent replay returns the same order instead of duplicating it
    const replay = await orderAPI.place(
      'demo',
      { items: [{ menuItemId: 'demo-mi-01', qty: 2 }], orderType: 'pickup' },
      'idem-key-1',
    );
    expect(replay.id).toBe(order.id);
    expect(JSON.parse(localStorage.getItem('sf_demo_orders_demo') ?? '[]')).toHaveLength(1);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
