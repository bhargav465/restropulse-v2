/**
 * demo-api-orders.ts — DEMO twin for the online-orders client (ordersAPI in api.ts).
 *
 * In-memory [SAMPLE] orders and ordering settings, moved with the same status
 * machine the API enforces (@restropulse/shared), so the demo can't show a
 * move the real server would refuse. Typed via `typeof realOrdersAPI`.
 */
import type { Order, OrderStatus, RestaurantOrderingSettings } from '@restropulse/shared';
import {
    canTransitionOrderStatus, isOrderStatus, isValidRestaurantSlug, resolveOrderingSettings, ACTIVE_ORDER_STATUSES,
} from '@restropulse/shared';
import type { AdminOrder, OrderFeed, OrderingSettingsView, RefundOutcome } from './api';
import { notifyDemoBackendAction } from './lib/demo';

const RID = 'demo-r1';
const delay = (ms = 120): Promise<void> => new Promise((r) => setTimeout(r, ms));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

interface DemoOrdersState {
    orders: AdminOrder[];
    slug: string | null;
    ordering: RestaurantOrderingSettings;
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function order(id: string, n: string, status: OrderStatus, over: Partial<AdminOrder>, ageMin: number): AdminOrder {
    const at = minutesAgo(ageMin);
    return {
        id, restaurantId: RID, orderNumber: n, orderType: 'pickup', status,
        statusHistory: [{ status, at, by: 'customer' }],
        items: [{ menuItemId: 'demo-item-3', categoryId: 'demo-cat-2', name: 'Hyderabadi Dum Biryani', qty: 1, unitPrice: 420, lineTotal: 420 }],
        totals: { subtotal: 420, discount: 0, deliveryFee: 0, deliveryDiscount: 0, tax: 21, total: 441 },
        paymentMethod: 'online', paymentStatus: 'paid',
        customerName: '[SAMPLE] Guest', customerPhone: '+910000000000',
        createdAt: at, updatedAt: at,
        ...over,
    };
}

function seed(): DemoOrdersState {
    return {
        slug: 'demo-kitchen',
        ordering: {
            storeOpen: true,
            taxRatePercent: 5,
            delivery: { enabled: true, flatFee: 40, minOrder: 200, freeAbove: 800 },
            pickup: { enabled: true },
            dineIn: { enabled: false },
            cashAccepted: true,
        },
        orders: [
            order('demo-ord-1', 'RP-DEMO01', 'RECEIVED', {
                orderType: 'delivery', customerName: '[SAMPLE] Asha',
                address: { line1: '[SAMPLE] 12 Road No. 1', city: 'Hyderabad' },
                items: [
                    { menuItemId: 'demo-item-3', categoryId: 'demo-cat-2', name: 'Hyderabadi Dum Biryani', qty: 2, unitPrice: 260, variant: { id: 'v1', name: 'Half', price: 260 }, lineTotal: 520 },
                    { menuItemId: 'demo-item-1', categoryId: 'demo-cat-1', name: 'Paneer Tikka', qty: 1, unitPrice: 280, lineTotal: 280 },
                ],
                totals: { subtotal: 800, discount: 0, deliveryFee: 0, deliveryDiscount: 0, tax: 40, total: 840 },
                notes: 'Less spicy, please',
            }, 3),
            order('demo-ord-2', 'RP-DEMO02', 'PREPARING', { customerName: '[SAMPLE] Ravi', paymentMethod: 'cash', paymentStatus: 'not_required' }, 12),
            order('demo-ord-3', 'RP-DEMO03', 'READY', { customerName: '[SAMPLE] Meera' }, 25),
            order('demo-ord-4', 'RP-DEMO04', 'COMPLETED', { customerName: '[SAMPLE] Kiran' }, 180),
        ],
    };
}

let state: DemoOrdersState = seed();

/** Test helper: restore the seed data. */
export function resetDemoOrders(): void {
    state = seed();
}

function find(id: string): AdminOrder {
    const o = state.orders.find((x) => x.id === id);
    if (!o) throw new Error('Order not found');
    return o;
}

function move(o: AdminOrder, to: OrderStatus, note?: string, extra: Partial<AdminOrder> = {}): void {
    const at = new Date().toISOString();
    Object.assign(o, { status: to, updatedAt: at, ...extra });
    o.statusHistory.push({ status: to, at, by: 'restaurant', ...(note ? { note } : {}) });
}

function settingsView(): OrderingSettingsView {
    return { slug: state.slug, suggestedSlug: state.slug ?? 'demo-kitchen', ordering: clone(state.ordering), onlinePaymentsAvailable: true };
}

export const ordersAPI = {
    getFeed: async (params: { status?: string; since?: string; limit?: number } = {}): Promise<OrderFeed> => {
        await delay();
        let list = state.orders;
        if (params.status === 'active') list = list.filter((o) => ACTIVE_ORDER_STATUSES.includes(o.status));
        else if (params.status && params.status !== 'all') {
            const wanted = params.status.split(',').map((s) => s.trim().toUpperCase()).filter(isOrderStatus);
            list = list.filter((o) => wanted.includes(o.status));
        }
        if (params.since) list = list.filter((o) => String(o.updatedAt) >= params.since!);
        const sorted = [...list].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        return { orders: clone(sorted.slice(0, params.limit ?? 50)), serverTime: new Date().toISOString() };
    },
    getOrder: async (id: string): Promise<AdminOrder> => {
        await delay();
        return clone(find(id));
    },
    setStatus: async (id: string, to: OrderStatus, note?: string): Promise<AdminOrder> => {
        await delay();
        const o = find(id);
        if (to === 'CANCELLED') throw new Error('Use cancel to cancel an order.');
        if (!canTransitionOrderStatus(o.status, to, o.orderType)) throw new Error("That status change isn't allowed.");
        move(o, to, note);
        notifyDemoBackendAction();
        return clone(o);
    },
    cancel: async (id: string, reason: string, refund = true): Promise<{ order: AdminOrder; refund: RefundOutcome }> => {
        await delay();
        const o = find(id);
        if (!canTransitionOrderStatus(o.status, 'CANCELLED', o.orderType)) throw new Error('This order can no longer be cancelled.');
        const refunds = refund && o.paymentMethod === 'online' && o.paymentStatus === 'paid';
        move(o, 'CANCELLED', reason, { cancelReason: reason, ...(refunds ? { paymentStatus: 'refund_pending' } : {}) });
        notifyDemoBackendAction();
        return { order: clone(o), refund: refunds ? 'requested' : 'none' };
    },
    getSettings: async (): Promise<OrderingSettingsView> => {
        await delay();
        return settingsView();
    },
    saveSettings: async (input: { slug?: string; ordering: RestaurantOrderingSettings }): Promise<OrderingSettingsView> => {
        await delay();
        const slug = input.slug?.trim().toLowerCase();
        if (slug !== undefined && !isValidRestaurantSlug(slug)) {
            throw new Error('Use 3 to 48 lowercase letters, numbers and single hyphens for the web address.');
        }
        if (input.ordering.storeOpen && !(slug ?? state.slug)) throw new Error('Choose a web address before opening for orders.');
        state.ordering = resolveOrderingSettings(clone(input.ordering));
        if (slug !== undefined) state.slug = slug;
        notifyDemoBackendAction();
        return settingsView();
    },
};

/** Exposed for tests: the raw demo state (orders the twin will return). */
export const _demoOrdersState = (): Readonly<DemoOrdersState> => state;

