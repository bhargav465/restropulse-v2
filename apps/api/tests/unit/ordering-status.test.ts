import { describe, test, expect } from 'vitest';
import type { OrderStatus } from '@restropulse/shared';
import {
    ORDER_STATUS_TRANSITIONS,
    canTransitionOrderStatus,
    isOrderStatus,
} from '../../src/services/ordering/status.js';

/**
 * Canonical order-status transition table. The api mirror
 * (src/services/ordering/status.ts) and the web mirror
 * (apps/web/components/ordering/order-status.ts) must both equal this exactly —
 * apps/web/tests/order-status-mirror.test.ts asserts the web side against the
 * same literal, keeping the two mirrors byte-equivalent.
 */
const CANONICAL_ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
    PENDING_PAYMENT: ['RECEIVED', 'PAYMENT_FAILED', 'CANCELLED'],
    PAYMENT_FAILED: ['PENDING_PAYMENT', 'CANCELLED'],
    RECEIVED: ['PREPARING', 'CANCELLED'],
    PREPARING: ['READY', 'CANCELLED'],
    READY: ['OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED'],
    OUT_FOR_DELIVERY: ['COMPLETED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
};

describe('order status transitions', () => {
    test('happy path for delivery: PENDING_PAYMENT → ... → COMPLETED', () => {
        const path: OrderStatus[] = ['PENDING_PAYMENT', 'RECEIVED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'COMPLETED'];
        for (let i = 0; i < path.length - 1; i++) {
            expect(canTransitionOrderStatus(path[i], path[i + 1], 'delivery')).toBe(true);
        }
    });

    test('happy path for pickup skips OUT_FOR_DELIVERY', () => {
        expect(canTransitionOrderStatus('READY', 'COMPLETED', 'pickup')).toBe(true);
        expect(canTransitionOrderStatus('READY', 'COMPLETED', 'dine_in')).toBe(true);
    });

    test('delivery orders cannot jump READY → COMPLETED', () => {
        expect(canTransitionOrderStatus('READY', 'COMPLETED', 'delivery')).toBe(false);
    });

    test('OUT_FOR_DELIVERY is invalid for pickup and dine_in orders', () => {
        expect(canTransitionOrderStatus('READY', 'OUT_FOR_DELIVERY', 'pickup')).toBe(false);
        expect(canTransitionOrderStatus('READY', 'OUT_FOR_DELIVERY', 'dine_in')).toBe(false);
    });

    test('cannot skip states', () => {
        expect(canTransitionOrderStatus('RECEIVED', 'READY', 'delivery')).toBe(false);
        expect(canTransitionOrderStatus('PENDING_PAYMENT', 'PREPARING', 'pickup')).toBe(false);
        expect(canTransitionOrderStatus('RECEIVED', 'COMPLETED', 'pickup')).toBe(false);
    });

    test('cannot move backwards', () => {
        expect(canTransitionOrderStatus('PREPARING', 'RECEIVED', 'delivery')).toBe(false);
        expect(canTransitionOrderStatus('COMPLETED', 'PREPARING', 'delivery')).toBe(false);
    });

    test('CANCELLED is reachable from every non-terminal state', () => {
        const nonTerminal: OrderStatus[] = ['PENDING_PAYMENT', 'PAYMENT_FAILED', 'RECEIVED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'];
        for (const from of nonTerminal) {
            expect(canTransitionOrderStatus(from, 'CANCELLED', 'delivery')).toBe(true);
        }
    });

    test('PENDING_PAYMENT can fail to PAYMENT_FAILED', () => {
        expect(canTransitionOrderStatus('PENDING_PAYMENT', 'PAYMENT_FAILED', 'delivery')).toBe(true);
        expect(canTransitionOrderStatus('PENDING_PAYMENT', 'PAYMENT_FAILED', 'pickup')).toBe(true);
    });

    test('PAYMENT_FAILED re-arms payment back to PENDING_PAYMENT (retry)', () => {
        expect(canTransitionOrderStatus('PAYMENT_FAILED', 'PENDING_PAYMENT', 'delivery')).toBe(true);
    });

    test('PAYMENT_FAILED cannot jump straight to RECEIVED (must re-arm first)', () => {
        expect(canTransitionOrderStatus('PAYMENT_FAILED', 'RECEIVED', 'delivery')).toBe(false);
        expect(canTransitionOrderStatus('PAYMENT_FAILED', 'PREPARING', 'delivery')).toBe(false);
    });

    test('terminal states allow no transitions', () => {
        for (const to of Object.keys(ORDER_STATUS_TRANSITIONS) as OrderStatus[]) {
            expect(canTransitionOrderStatus('COMPLETED', to, 'delivery')).toBe(false);
            expect(canTransitionOrderStatus('CANCELLED', to, 'delivery')).toBe(false);
        }
    });
});

describe('status machine mirror (api ⇄ web)', () => {
    test('api ORDER_STATUS_TRANSITIONS equals the canonical table', () => {
        expect(ORDER_STATUS_TRANSITIONS).toEqual(CANONICAL_ORDER_STATUS_TRANSITIONS);
    });
});

describe('isOrderStatus', () => {
    test('accepts known statuses and rejects everything else', () => {
        expect(isOrderStatus('RECEIVED')).toBe(true);
        expect(isOrderStatus('PENDING_PAYMENT')).toBe(true);
        expect(isOrderStatus('received')).toBe(false);
        expect(isOrderStatus('DELETED')).toBe(false);
        expect(isOrderStatus(42)).toBe(false);
        expect(isOrderStatus(undefined)).toBe(false);
    });
});
