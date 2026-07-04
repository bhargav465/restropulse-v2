/**
 * Pure cart state + money math for the storefront.
 * Mirrors the server-side totals logic in apps/api/src/services/ordering/totals.ts
 * (prices are still re-resolved server-side when the order is placed).
 * Unit tested in tests/cart.test.ts.
 */
import type { OrderType } from '@restropulse/shared';

export const MAX_QTY_PER_LINE = 50;

export interface CartAddon {
  id: string;
  name: string;
  price: number;
}

export interface CartVariant {
  id: string;
  name: string;
  price: number;
}

export interface CartLine {
  /** Stable identity: menuItemId + variant + sorted addon ids. */
  key: string;
  menuItemId: string;
  name: string;
  isVeg: boolean;
  image?: string;
  /** Per-unit price (variant price if selected, else base price). */
  unitPrice: number;
  qty: number;
  variant?: CartVariant;
  addons: CartAddon[];
}

export interface CartTotals {
  subtotal: number;
  tax: number;
  deliveryFee: number;
  discount: number;
  total: number;
  /** Amount still needed to reach the delivery minimum (0 when met / not delivery). */
  minOrderShortfall: number;
}

export interface CartTotalsOptions {
  orderType: OrderType;
  /** Tax percentage applied to subtotal, e.g. 5 => 5%. */
  taxRatePercent?: number;
  delivery?: { flatFee: number; minOrder: number };
}

/** Round to 2 decimals, avoiding float drift (same as server). */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function lineKey(menuItemId: string, variantId?: string, addonIds: string[] = []): string {
  return `${menuItemId}|${variantId ?? ''}|${[...addonIds].sort().join(',')}`;
}

export function lineTotal(line: CartLine): number {
  const addonsPerUnit = line.addons.reduce((sum, a) => sum + a.price, 0);
  return roundMoney((line.unitPrice + addonsPerUnit) * line.qty);
}

export interface AddLineInput {
  menuItemId: string;
  name: string;
  isVeg: boolean;
  image?: string;
  /** Base item price — used when no variant is selected. */
  basePrice: number;
  variant?: CartVariant;
  addons?: CartAddon[];
  qty?: number;
}

/** Adds an item to the cart, merging with an identical existing line. */
export function addLine(lines: CartLine[], input: AddLineInput): CartLine[] {
  const qty = Math.max(1, Math.floor(input.qty ?? 1));
  const addons = input.addons ?? [];
  const key = lineKey(input.menuItemId, input.variant?.id, addons.map((a) => a.id));
  const existing = lines.find((l) => l.key === key);

  if (existing) {
    return lines.map((l) =>
      l.key === key ? { ...l, qty: Math.min(l.qty + qty, MAX_QTY_PER_LINE) } : l,
    );
  }

  const newLine: CartLine = {
    key,
    menuItemId: input.menuItemId,
    name: input.name,
    isVeg: input.isVeg,
    ...(input.image ? { image: input.image } : {}),
    unitPrice: input.variant ? input.variant.price : input.basePrice,
    qty: Math.min(qty, MAX_QTY_PER_LINE),
    ...(input.variant ? { variant: input.variant } : {}),
    addons,
  };
  return [...lines, newLine];
}

/** Sets a line's quantity; qty <= 0 removes the line. */
export function updateQty(lines: CartLine[], key: string, qty: number): CartLine[] {
  const next = Math.floor(qty);
  if (next <= 0) return lines.filter((l) => l.key !== key);
  return lines.map((l) => (l.key === key ? { ...l, qty: Math.min(next, MAX_QTY_PER_LINE) } : l));
}

export function removeLine(lines: CartLine[], key: string): CartLine[] {
  return lines.filter((l) => l.key !== key);
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.qty, 0);
}

/**
 * Computes the client-side totals breakdown. Mirrors the server, except the
 * delivery minimum is reported as a shortfall instead of throwing.
 */
export function computeCartTotals(lines: CartLine[], opts: CartTotalsOptions): CartTotals {
  const subtotal = roundMoney(lines.reduce((sum, l) => sum + lineTotal(l), 0));

  let deliveryFee = 0;
  let minOrderShortfall = 0;
  if (opts.orderType === 'delivery') {
    const delivery = opts.delivery ?? { flatFee: 0, minOrder: 0 };
    deliveryFee = lines.length > 0 ? roundMoney(delivery.flatFee) : 0;
    if (subtotal < delivery.minOrder) {
      minOrderShortfall = roundMoney(delivery.minOrder - subtotal);
    }
  }

  const tax = roundMoney(subtotal * ((opts.taxRatePercent ?? 0) / 100));
  const discount = 0; // coupons are UI-only in v1
  const total = roundMoney(subtotal + tax + deliveryFee - discount);

  return { subtotal, tax, deliveryFee, discount, total, minOrderShortfall };
}

// ----- localStorage persistence (per storefront slug) -----

function cartStorageKey(slug: string): string {
  return `sf_cart_${slug}`;
}

export function loadCart(slug: string): CartLine[] {
  try {
    const raw = localStorage.getItem(cartStorageKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (l): l is CartLine =>
        l && typeof l === 'object' &&
        typeof l.key === 'string' &&
        typeof l.menuItemId === 'string' &&
        typeof l.unitPrice === 'number' &&
        typeof l.qty === 'number' && l.qty > 0 &&
        Array.isArray(l.addons),
    );
  } catch {
    return [];
  }
}

export function saveCart(slug: string, lines: CartLine[]): void {
  try {
    localStorage.setItem(cartStorageKey(slug), JSON.stringify(lines));
  } catch {
    /* quota / private mode — cart just won't persist */
  }
}
