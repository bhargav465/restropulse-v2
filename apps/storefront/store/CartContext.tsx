import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import type { OrderType } from '@restropulse/shared';
import {
  addLine,
  AddLineInput,
  CartLine,
  CartTotals,
  cartCount,
  computeCartTotals,
  loadCart,
  removeLine,
  saveCart,
  updateQty,
} from '../lib/cart';
import { track } from '../lib/analytics';
import { useStorefront } from './StorefrontContext';

interface CartContextValue {
  lines: CartLine[];
  count: number;
  totals: CartTotals;
  orderType: OrderType;
  availableOrderTypes: OrderType[];
  setOrderType: (type: OrderType) => void;
  addItem: (input: AddLineInput) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { slug, ordering } = useStorefront();
  const [lines, setLines] = useState<CartLine[]>(() => loadCart(slug));

  // Order types enabled by the restaurant (checkout supports delivery/pickup)
  const availableOrderTypes = useMemo<OrderType[]>(() => {
    const types: OrderType[] = [];
    if (ordering.delivery?.enabled !== false) types.push('delivery');
    if (ordering.pickup?.enabled !== false) types.push('pickup');
    return types.length > 0 ? types : ['pickup'];
  }, [ordering]);

  const [orderType, setOrderTypeState] = useState<OrderType>('delivery');

  useEffect(() => {
    if (!availableOrderTypes.includes(orderType)) {
      setOrderTypeState(availableOrderTypes[0]);
    }
  }, [availableOrderTypes, orderType]);

  // Re-hydrate when the storefront slug changes
  useEffect(() => {
    setLines(loadCart(slug));
  }, [slug]);

  // Persist on every change
  useEffect(() => {
    saveCart(slug, lines);
  }, [slug, lines]);

  const totals = useMemo(
    () =>
      computeCartTotals(lines, {
        orderType,
        taxRatePercent: ordering.taxRatePercent ?? 0,
        ...(ordering.delivery
          ? { delivery: { flatFee: ordering.delivery.flatFee, minOrder: ordering.delivery.minOrder } }
          : {}),
      }),
    [lines, orderType, ordering],
  );

  const addItem = useCallback((input: AddLineInput) => {
    setLines((prev) => addLine(prev, input));
    track(slug, 'add_to_cart', {
      menuItemId: input.menuItemId,
      name: input.name,
      qty: input.qty ?? 1,
      ...(input.variant ? { variantId: input.variant.id } : {}),
    });
  }, [slug]);

  const value: CartContextValue = {
    lines,
    count: cartCount(lines),
    totals,
    orderType,
    availableOrderTypes,
    setOrderType: setOrderTypeState,
    addItem,
    setQty: (key, qty) => setLines((prev) => updateQty(prev, key, qty)),
    remove: (key) => setLines((prev) => removeLine(prev, key)),
    clear: () => setLines([]),
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};
