/**
 * Server-side order validation + totals computation (v1).
 * Prices are always resolved against the stored menu — client-supplied
 * prices are ignored. Pure functions — unit tested in
 * tests/unit/ordering-totals.test.ts.
 */

import type {
    OrderingMenuItem,
    OrderItemSnapshot,
    OrderTotals,
    OrderType,
} from '@restropulse/shared';

export type OrderValidationCode =
    | 'EMPTY_ORDER'
    | 'INVALID_QTY'
    | 'ITEM_NOT_FOUND'
    | 'ITEM_UNAVAILABLE'
    | 'VARIANT_NOT_FOUND'
    | 'ADDON_NOT_FOUND'
    | 'MIN_ORDER_NOT_MET';

export class OrderValidationError extends Error {
    readonly code: OrderValidationCode;

    constructor(code: OrderValidationCode, message: string) {
        super(message);
        this.name = 'OrderValidationError';
        this.code = code;
    }
}

export interface RequestedOrderItem {
    menuItemId: string;
    qty: number;
    variantId?: string;
    addonIds?: string[];
}

export interface ComputeTotalsOptions {
    orderType: OrderType;
    /** Tax percentage applied to subtotal, e.g. 5 => 5%. Defaults to 0. */
    taxRatePercent?: number;
    /** Delivery settings — required to price delivery orders. */
    delivery?: { flatFee: number; minOrder: number };
    /** Flat discount amount (v1: not exposed publicly, defaults to 0). */
    discount?: number;
}

const MAX_QTY_PER_LINE = 50;

/** Round to 2 decimals, avoiding float drift. */
export function roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Validates requested items against the stored menu and computes the
 * order snapshot + totals breakdown.
 * @throws OrderValidationError
 */
export function computeOrderTotals(
    requested: RequestedOrderItem[],
    menuItems: OrderingMenuItem[],
    opts: ComputeTotalsOptions,
): { items: OrderItemSnapshot[]; totals: OrderTotals } {
    if (!Array.isArray(requested) || requested.length === 0) {
        throw new OrderValidationError('EMPTY_ORDER', 'Order must contain at least one item');
    }

    const menuById = new Map(menuItems.map((m) => [m.id, m]));
    const items: OrderItemSnapshot[] = [];

    for (const line of requested) {
        if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > MAX_QTY_PER_LINE) {
            throw new OrderValidationError('INVALID_QTY', `Invalid quantity for item ${line.menuItemId}`);
        }

        const menuItem = menuById.get(line.menuItemId);
        if (!menuItem) {
            throw new OrderValidationError('ITEM_NOT_FOUND', `Menu item ${line.menuItemId} not found`);
        }
        if (menuItem.availability !== 'in_stock') {
            throw new OrderValidationError('ITEM_UNAVAILABLE', `"${menuItem.name}" is currently unavailable`);
        }

        let unitPrice = menuItem.price;
        let variant: OrderItemSnapshot['variant'];
        if (line.variantId) {
            const found = (menuItem.variants ?? []).find((v) => v.id === line.variantId);
            if (!found) {
                throw new OrderValidationError('VARIANT_NOT_FOUND', `Variant ${line.variantId} not found on "${menuItem.name}"`);
            }
            unitPrice = found.price;
            variant = { id: found.id, name: found.name, price: found.price };
        }

        const addons: NonNullable<OrderItemSnapshot['addons']> = [];
        for (const addonId of line.addonIds ?? []) {
            const found = (menuItem.addons ?? []).find((a) => a.id === addonId);
            if (!found) {
                throw new OrderValidationError('ADDON_NOT_FOUND', `Addon ${addonId} not found on "${menuItem.name}"`);
            }
            addons.push({ id: found.id, name: found.name, price: found.price });
        }

        const addonsPerUnit = addons.reduce((sum, a) => sum + a.price, 0);
        const lineTotal = roundMoney((unitPrice + addonsPerUnit) * line.qty);

        items.push({
            menuItemId: menuItem.id,
            name: menuItem.name,
            qty: line.qty,
            unitPrice,
            ...(variant ? { variant } : {}),
            ...(addons.length > 0 ? { addons } : {}),
            lineTotal,
        });
    }

    const subtotal = roundMoney(items.reduce((sum, i) => sum + i.lineTotal, 0));

    let deliveryFee = 0;
    if (opts.orderType === 'delivery') {
        const delivery = opts.delivery ?? { flatFee: 0, minOrder: 0 };
        if (subtotal < delivery.minOrder) {
            throw new OrderValidationError(
                'MIN_ORDER_NOT_MET',
                `Minimum order for delivery is ${delivery.minOrder}`,
            );
        }
        deliveryFee = roundMoney(delivery.flatFee);
    }

    const tax = roundMoney(subtotal * ((opts.taxRatePercent ?? 0) / 100));
    const discount = roundMoney(Math.min(opts.discount ?? 0, subtotal));
    const total = roundMoney(subtotal + tax + deliveryFee - discount);

    return { items, totals: { subtotal, tax, deliveryFee, discount, total } };
}
