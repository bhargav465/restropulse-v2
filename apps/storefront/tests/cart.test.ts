import { describe, it, expect } from 'vitest';
import {
    addLine,
    cartCount,
    computeCartTotals,
    lineKey,
    lineTotal,
    loadCart,
    MAX_QTY_PER_LINE,
    removeLine,
    roundMoney,
    saveCart,
    updateQty,
    CartLine,
} from '../lib/cart';

const pizza = {
    menuItemId: 'pizza-1',
    name: 'Margherita',
    isVeg: true,
    basePrice: 250,
};

const cheese = { id: 'ad-1', name: 'Extra Cheese', price: 40 };
const olives = { id: 'ad-2', name: 'Olives', price: 30 };
const halfVariant = { id: 'v-1', name: 'Half', price: 150 };

describe('cart math', () => {
    describe('lineKey', () => {
        it('is stable regardless of addon order', () => {
            expect(lineKey('m1', 'v1', ['a2', 'a1'])).toBe(lineKey('m1', 'v1', ['a1', 'a2']));
        });

        it('differs for different variants', () => {
            expect(lineKey('m1', 'v1')).not.toBe(lineKey('m1', 'v2'));
        });
    });

    describe('addLine', () => {
        it('adds a new line with the base price when no variant is selected', () => {
            const lines = addLine([], { ...pizza, qty: 2 });
            expect(lines).toHaveLength(1);
            expect(lines[0].unitPrice).toBe(250);
            expect(lines[0].qty).toBe(2);
        });

        it('uses the variant price when a variant is selected', () => {
            const lines = addLine([], { ...pizza, variant: halfVariant });
            expect(lines[0].unitPrice).toBe(150);
            expect(lines[0].variant?.name).toBe('Half');
        });

        it('merges identical lines by increasing quantity', () => {
            let lines = addLine([], { ...pizza, addons: [cheese], qty: 1 });
            lines = addLine(lines, { ...pizza, addons: [cheese], qty: 2 });
            expect(lines).toHaveLength(1);
            expect(lines[0].qty).toBe(3);
        });

        it('keeps separate lines for different addon combinations', () => {
            let lines = addLine([], { ...pizza, addons: [cheese] });
            lines = addLine(lines, { ...pizza, addons: [olives] });
            expect(lines).toHaveLength(2);
        });

        it('caps merged quantity at MAX_QTY_PER_LINE', () => {
            let lines = addLine([], { ...pizza, qty: 49 });
            lines = addLine(lines, { ...pizza, qty: 5 });
            expect(lines[0].qty).toBe(MAX_QTY_PER_LINE);
        });
    });

    describe('updateQty / removeLine / cartCount', () => {
        it('updates the quantity of the matching line', () => {
            let lines = addLine([], pizza);
            lines = updateQty(lines, lines[0].key, 4);
            expect(lines[0].qty).toBe(4);
        });

        it('removes the line when quantity drops to zero', () => {
            let lines = addLine([], pizza);
            lines = updateQty(lines, lines[0].key, 0);
            expect(lines).toHaveLength(0);
        });

        it('removes a line by key', () => {
            let lines = addLine([], pizza);
            lines = addLine(lines, { ...pizza, variant: halfVariant });
            lines = removeLine(lines, lines[0].key);
            expect(lines).toHaveLength(1);
        });

        it('counts total units across lines', () => {
            let lines = addLine([], { ...pizza, qty: 2 });
            lines = addLine(lines, { ...pizza, variant: halfVariant, qty: 3 });
            expect(cartCount(lines)).toBe(5);
        });
    });

    describe('lineTotal', () => {
        it('includes addons per unit', () => {
            const lines = addLine([], { ...pizza, addons: [cheese, olives], qty: 2 });
            // (250 + 40 + 30) * 2
            expect(lineTotal(lines[0])).toBe(640);
        });
    });

    describe('computeCartTotals', () => {
        const opts = {
            orderType: 'delivery' as const,
            taxRatePercent: 5,
            delivery: { flatFee: 30, minOrder: 200 },
        };

        it('computes subtotal, tax, delivery fee and total', () => {
            const lines = addLine([], { ...pizza, qty: 2 }); // 500
            const totals = computeCartTotals(lines, opts);
            expect(totals.subtotal).toBe(500);
            expect(totals.tax).toBe(25);
            expect(totals.deliveryFee).toBe(30);
            expect(totals.discount).toBe(0);
            expect(totals.total).toBe(555);
            expect(totals.minOrderShortfall).toBe(0);
        });

        it('reports the delivery minimum shortfall', () => {
            const lines = addLine([], { ...pizza, variant: halfVariant }); // 150 < 200
            const totals = computeCartTotals(lines, opts);
            expect(totals.minOrderShortfall).toBe(50);
        });

        it('skips delivery fee and minimum for pickup orders', () => {
            const lines = addLine([], { ...pizza, variant: halfVariant });
            const totals = computeCartTotals(lines, { ...opts, orderType: 'pickup' });
            expect(totals.deliveryFee).toBe(0);
            expect(totals.minOrderShortfall).toBe(0);
            expect(totals.total).toBe(roundMoney(150 + 7.5));
        });

        it('returns zeroed totals for an empty cart (no delivery fee)', () => {
            const totals = computeCartTotals([], opts);
            expect(totals.subtotal).toBe(0);
            expect(totals.deliveryFee).toBe(0);
        });

        it('rounds money to 2 decimals without float drift', () => {
            const lines = addLine([], { ...pizza, basePrice: 33.33, qty: 3 }); // 99.99
            const totals = computeCartTotals(lines, { orderType: 'pickup', taxRatePercent: 5 });
            expect(totals.subtotal).toBe(99.99);
            expect(totals.tax).toBe(5);
            expect(totals.total).toBe(104.99);
        });
    });

    describe('persistence', () => {
        it('round-trips the cart through localStorage', () => {
            const lines = addLine([], { ...pizza, addons: [cheese], qty: 2 });
            saveCart('demo', lines);
            expect(loadCart('demo')).toEqual(lines);
        });

        it('is scoped per slug', () => {
            saveCart('demo', addLine([], pizza));
            expect(loadCart('other')).toEqual([]);
        });

        it('returns an empty cart for corrupt stored data', () => {
            localStorage.setItem('sf_cart_demo', 'not-json{');
            expect(loadCart('demo')).toEqual([]);
        });

        it('filters malformed lines out of stored data', () => {
            const good: CartLine = addLine([], pizza)[0];
            localStorage.setItem('sf_cart_demo', JSON.stringify([good, { bogus: true }, null]));
            expect(loadCart('demo')).toEqual([good]);
        });
    });
});
