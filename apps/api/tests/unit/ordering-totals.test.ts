import { describe, test, expect } from 'vitest';
import type { OrderingMenuItem } from '@restropulse/shared';
import { computeOrderTotals, OrderValidationError, roundMoney } from '../../src/services/ordering/totals.js';

const menu: OrderingMenuItem[] = [
    {
        id: 'mi-1',
        restaurantId: 'r1',
        categoryId: 'cat-1',
        name: 'Butter Chicken',
        price: 380,
        isVeg: false,
        variants: [
            { id: 'v-half', name: 'Half', price: 240 },
            { id: 'v-full', name: 'Full', price: 380 },
        ],
        addons: [{ id: 'a-butter', name: 'Extra Butter', price: 30 }],
        availability: 'in_stock',
        sortOrder: 1,
    },
    {
        id: 'mi-2',
        restaurantId: 'r1',
        categoryId: 'cat-1',
        name: 'Butter Naan',
        price: 60,
        isVeg: true,
        availability: 'in_stock',
        sortOrder: 2,
    },
    {
        id: 'mi-3',
        restaurantId: 'r1',
        categoryId: 'cat-1',
        name: 'Fish Amritsari',
        price: 340,
        isVeg: false,
        availability: 'out_of_stock',
        sortOrder: 3,
    },
];

describe('computeOrderTotals', () => {
    test('computes subtotal, tax, delivery fee and total for a simple order', () => {
        const { items, totals } = computeOrderTotals(
            [
                { menuItemId: 'mi-1', qty: 1, variantId: 'v-half', addonIds: ['a-butter'] },
                { menuItemId: 'mi-2', qty: 4 },
            ],
            menu,
            { orderType: 'delivery', taxRatePercent: 5, delivery: { flatFee: 40, minOrder: 199 } },
        );

        // (240 + 30) * 1 = 270; 60 * 4 = 240 → subtotal 510
        expect(items).toHaveLength(2);
        expect(items[0].unitPrice).toBe(240);
        expect(items[0].variant?.name).toBe('Half');
        expect(items[0].addons?.[0].price).toBe(30);
        expect(items[0].lineTotal).toBe(270);
        expect(items[1].lineTotal).toBe(240);
        expect(totals.subtotal).toBe(510);
        expect(totals.tax).toBe(25.5);
        expect(totals.deliveryFee).toBe(40);
        expect(totals.discount).toBe(0);
        expect(totals.total).toBe(575.5);
    });

    test('uses base price when no variant is selected', () => {
        const { totals } = computeOrderTotals(
            [{ menuItemId: 'mi-1', qty: 2 }],
            menu,
            { orderType: 'pickup', taxRatePercent: 0 },
        );
        expect(totals.subtotal).toBe(760);
        expect(totals.deliveryFee).toBe(0);
        expect(totals.total).toBe(760);
    });

    test('ignores any client-side prices — snapshot comes from the menu', () => {
        const { items } = computeOrderTotals(
            // extra fields like a spoofed price are simply not read
            [{ menuItemId: 'mi-2', qty: 1, price: 1 } as never],
            menu,
            { orderType: 'pickup' },
        );
        expect(items[0].unitPrice).toBe(60);
    });

    test('applies discount capped at subtotal', () => {
        const { totals } = computeOrderTotals(
            [{ menuItemId: 'mi-2', qty: 1 }],
            menu,
            { orderType: 'pickup', discount: 1000 },
        );
        expect(totals.discount).toBe(60);
        expect(totals.total).toBe(0);
    });

    test('rounds tax to 2 decimals', () => {
        const { totals } = computeOrderTotals(
            [{ menuItemId: 'mi-2', qty: 1 }],
            menu,
            { orderType: 'pickup', taxRatePercent: 7.33 },
        );
        expect(totals.tax).toBe(4.4); // 60 * 0.0733 = 4.398 → 4.4
    });

    test('throws EMPTY_ORDER for an empty items array', () => {
        expect(() => computeOrderTotals([], menu, { orderType: 'pickup' }))
            .toThrowError(expect.objectContaining({ code: 'EMPTY_ORDER' }));
    });

    test('throws INVALID_QTY for zero, negative or fractional quantities', () => {
        for (const qty of [0, -1, 1.5]) {
            expect(() => computeOrderTotals([{ menuItemId: 'mi-2', qty }], menu, { orderType: 'pickup' }))
                .toThrowError(expect.objectContaining({ code: 'INVALID_QTY' }));
        }
    });

    test('throws ITEM_NOT_FOUND for unknown menu item ids', () => {
        expect(() => computeOrderTotals([{ menuItemId: 'nope', qty: 1 }], menu, { orderType: 'pickup' }))
            .toThrowError(expect.objectContaining({ code: 'ITEM_NOT_FOUND' }));
    });

    test('throws ITEM_UNAVAILABLE for out_of_stock items', () => {
        expect(() => computeOrderTotals([{ menuItemId: 'mi-3', qty: 1 }], menu, { orderType: 'pickup' }))
            .toThrowError(expect.objectContaining({ code: 'ITEM_UNAVAILABLE' }));
    });

    test('throws VARIANT_NOT_FOUND / ADDON_NOT_FOUND for bad selections', () => {
        expect(() => computeOrderTotals([{ menuItemId: 'mi-1', qty: 1, variantId: 'v-missing' }], menu, { orderType: 'pickup' }))
            .toThrowError(expect.objectContaining({ code: 'VARIANT_NOT_FOUND' }));
        expect(() => computeOrderTotals([{ menuItemId: 'mi-1', qty: 1, addonIds: ['a-missing'] }], menu, { orderType: 'pickup' }))
            .toThrowError(expect.objectContaining({ code: 'ADDON_NOT_FOUND' }));
    });

    test('throws MIN_ORDER_NOT_MET when delivery subtotal is below minimum', () => {
        expect(() =>
            computeOrderTotals([{ menuItemId: 'mi-2', qty: 1 }], menu, {
                orderType: 'delivery',
                delivery: { flatFee: 40, minOrder: 199 },
            }),
        ).toThrowError(expect.objectContaining({ code: 'MIN_ORDER_NOT_MET' }));
    });

    test('does not apply min order / delivery fee to pickup orders', () => {
        const { totals } = computeOrderTotals([{ menuItemId: 'mi-2', qty: 1 }], menu, {
            orderType: 'pickup',
            delivery: { flatFee: 40, minOrder: 199 },
        });
        expect(totals.deliveryFee).toBe(0);
    });

    test('errors are OrderValidationError instances', () => {
        try {
            computeOrderTotals([], menu, { orderType: 'pickup' });
            expect.unreachable();
        } catch (err) {
            expect(err).toBeInstanceOf(OrderValidationError);
        }
    });
});

describe('roundMoney', () => {
    test('rounds to 2 decimals without float drift', () => {
        expect(roundMoney(1.005)).toBe(1.01);
        expect(roundMoney(2.675)).toBe(2.68);
        expect(roundMoney(10)).toBe(10);
    });
});
