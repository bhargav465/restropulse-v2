/**
 * demo-api-delivery.ts — DEMO twin for the rider dispatch client (deliveryAPI in api.ts).
 *
 * Own riders plus the test partner. Booking is instant (no worker); a test
 * partner booking moves one step each time the order's rider panel is read,
 * and the demo order moves with it (picked up -> out for delivery,
 * delivered -> completed), using the same rules as the server.
 * Typed via `typeof realDeliveryAPI`.
 */
import type { DeliveryProviderInfo, OrderStatus, RestaurantDeliverySettings, Shipment, ShipmentStatus } from '@restropulse/shared';
import { canTransitionShipment, isTerminalShipment, orderPathTo, orderStatusForShipment, resolveDeliverySettings } from '@restropulse/shared';
import type { OrderRiderView, OwnRiderStep } from './api';
import { ordersAPI as demoOrders } from './demo-api-orders';
import { notifyDemoBackendAction } from './lib/demo';

const delay = (ms = 120): Promise<void> => new Promise((r) => setTimeout(r, ms));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const PROVIDERS: DeliveryProviderInfo[] = [
    { id: 'self', label: 'Your own riders', kind: 'own', webhooks: false },
    { id: 'mock', label: 'Test partner (mock)', kind: 'partner', webhooks: false },
];
const PARTNER_FLOW: ShipmentStatus[] = ['BOOKED', 'RIDER_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED'];
const DISPATCHABLE: OrderStatus[] = ['RECEIVED', 'PREPARING', 'READY'];

interface DemoDeliveryState {
    settings: RestaurantDeliverySettings;
    shipments: Shipment[];
    seq: number;
}

let state: DemoDeliveryState;

export function resetDemoDelivery(): void {
    state = { settings: resolveDeliverySettings({ dispatchEnabled: true, providers: ['mock', 'self'] }), shipments: [], seq: 0 };
}
resetDemoDelivery();

const latest = (orderId: string) => [...state.shipments].reverse().find((s) => s.orderId === orderId) ?? null;
const view = (orderId: string, extra: Partial<OrderRiderView> = {}): OrderRiderView => ({ shipment: clone(latest(orderId)), queued: null, lastError: null, ...extra });

async function deliveryOrder(orderId: string) {
    const order = await demoOrders.getOrder(orderId);
    if (order.orderType !== 'delivery') throw new Error('Only delivery orders have riders.');
    return order;
}

/** Move the demo order to what the shipment implies, one allowed step at a time. */
async function syncOrder(s: Shipment): Promise<OrderStatus> {
    let order = await demoOrders.getOrder(s.orderId);
    const target = orderStatusForShipment(s.status);
    if (target) for (const step of orderPathTo(order.status, target)) order = await demoOrders.setStatus(order.id, step);
    return order.status;
}

function move(s: Shipment, to: ShipmentStatus, source: 'provider' | 'restaurant', extra: Partial<Shipment> = {}) {
    Object.assign(s, extra, { status: to, updatedAt: new Date().toISOString() });
    s.events.push({ status: to, at: new Date().toISOString(), source });
}

function book(orderId: string, provider: 'self' | 'mock'): Shipment {
    const now = new Date().toISOString();
    const s: Shipment = {
        id: `demo-ship-${++state.seq}`, restaurantId: 'demo-r1', orderId, provider,
        providerShipmentId: `${provider}_${orderId}_${state.seq}`, status: 'BOOKED',
        carrier: provider === 'self' ? 'Own rider' : 'Mock Rider Co',
        ...(provider === 'mock' ? { fee: 45, etaMinutes: 30 } : {}),
        events: [{ status: 'BOOKED', at: now, source: 'dispatcher', note: provider === 'self' ? 'Your own riders' : 'Booked with mock' }],
        createdAt: now, updatedAt: now,
    };
    state.shipments.push(s);
    return s;
}

async function bookable(orderId: string) {
    const order = await deliveryOrder(orderId);
    if (!DISPATCHABLE.includes(order.status)) throw new Error('This order is past the point of finding a rider.');
    const live = latest(orderId);
    if (live && !isTerminalShipment(live.status)) throw new Error('A rider is already booked. Cancel it first.');
}

export const deliveryAPI = {
    getSettings: async () => {
        await delay();
        return { settings: clone(state.settings), providers: clone(PROVIDERS) };
    },
    saveSettings: async (settings: RestaurantDeliverySettings) => {
        await delay();
        const missing = settings.providers.find((p) => !PROVIDERS.some((x) => x.id === p));
        if (missing) throw new Error(`${missing} isn't available yet.`);
        state.settings = resolveDeliverySettings(settings);
        notifyDemoBackendAction();
        return { settings: clone(state.settings), providers: clone(PROVIDERS) };
    },
    getRider: async (orderId: string): Promise<OrderRiderView> => {
        await delay();
        await deliveryOrder(orderId);
        const s = latest(orderId);
        if (s?.provider === 'mock' && !isTerminalShipment(s.status)) {
            const next = PARTNER_FLOW[PARTNER_FLOW.indexOf(s.status) + 1];
            move(s, next, 'provider', next === 'RIDER_ASSIGNED' ? { rider: { name: '[SAMPLE] Test Rider' } } : {});
            return view(orderId, { orderStatus: await syncOrder(s) });
        }
        return view(orderId);
    },
    findRider: async (orderId: string): Promise<OrderRiderView> => {
        await delay();
        await bookable(orderId);
        book(orderId, state.settings.providers.includes('mock') ? 'mock' : 'self');
        notifyDemoBackendAction();
        return view(orderId);
    },
    useOwnRider: async (orderId: string): Promise<OrderRiderView> => {
        await delay();
        await bookable(orderId);
        book(orderId, 'self');
        return view(orderId);
    },
    updateOwnRider: async (orderId: string, input: { status: OwnRiderStep; riderName?: string; riderPhone?: string }): Promise<OrderRiderView> => {
        await delay();
        await deliveryOrder(orderId);
        const s = latest(orderId);
        if (!s || s.provider !== 'self') throw new Error('Only orders with your own rider can be updated here.');
        if (!canTransitionShipment(s.status, input.status)) throw new Error('That step is already done or no longer possible.');
        const rider = input.riderName || input.riderPhone ? { ...s.rider, ...(input.riderName ? { name: input.riderName } : {}), ...(input.riderPhone ? { phone: input.riderPhone } : {}) } : undefined;
        move(s, input.status, 'restaurant', rider ? { rider } : {});
        return view(orderId, { orderStatus: await syncOrder(s) });
    },
    cancelRider: async (orderId: string, reason: string): Promise<OrderRiderView> => {
        await delay();
        await deliveryOrder(orderId);
        const s = latest(orderId);
        if (!s || isTerminalShipment(s.status)) throw new Error('There is no rider booking to cancel.');
        if (!canTransitionShipment(s.status, 'CANCELLED')) throw new Error('The rider already has the food, so the booking can no longer be cancelled.');
        move(s, 'CANCELLED', 'restaurant', { cancelReason: reason });
        return view(orderId);
    },
};

export const _demoDeliveryState = (): Readonly<DemoDeliveryState> => state;
