/**
 * Status-machine mirror guard.
 *
 * The web mirror (components/ordering/order-status.ts) and the api mirror
 * (apps/api/src/services/ordering/status.ts) must stay byte-equivalent on
 * ORDER_STATUS_TRANSITIONS. Both are asserted against the SAME canonical literal
 * (the api side lives in apps/api/tests/unit/ordering-status.test.ts). Cross-app
 * imports break tsc rootDir, so a shared literal is the enforcement mechanism —
 * change the machine in one place and this test fails until both are updated.
 */
import { describe, test, expect } from 'vitest';
import type { OrderStatus } from '@restropulse/shared';
import { ORDER_STATUS_TRANSITIONS, ORDER_STATUS_LABELS } from '../components/ordering/order-status';

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

describe('web order-status mirror', () => {
    test('web ORDER_STATUS_TRANSITIONS equals the canonical table', () => {
        expect(ORDER_STATUS_TRANSITIONS).toEqual(CANONICAL_ORDER_STATUS_TRANSITIONS);
    });

    test('every status has a human label, incl. PAYMENT_FAILED', () => {
        for (const status of Object.keys(CANONICAL_ORDER_STATUS_TRANSITIONS) as OrderStatus[]) {
            expect(ORDER_STATUS_LABELS[status]).toBeTruthy();
        }
        expect(ORDER_STATUS_LABELS.PAYMENT_FAILED).toBe('Payment Failed');
    });
});
