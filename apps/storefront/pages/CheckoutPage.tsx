import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { CustomerAddress, Order, OrderAddress, OrderType } from '@restropulse/shared';
import { useStorefront } from '../store/StorefrontContext';
import { useCart } from '../store/CartContext';
import { useAuth } from '../store/AuthContext';
import { addressAPI, orderAPI } from '../api';
import { formatMoney } from '../lib/format';
import { track } from '../lib/analytics';
import AuthForms from '../components/AuthForms';
import { EmptyState } from '../components/States';

function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  delivery: 'Delivery',
  pickup: 'Pickup',
  dine_in: 'Dine-in',
};

const CheckoutPage: React.FC = () => {
  const { slug, currency, ordering, storeOpen } = useStorefront();
  const { lines, totals, clear, orderType, setOrderType, availableOrderTypes } = useCart();
  const { isLoggedIn, customer } = useAuth();
  const navigate = useNavigate();

  const [savedAddresses, setSavedAddresses] = useState<CustomerAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>('new');
  const [address, setAddress] = useState<OrderAddress>({ line1: '' });
  const [saveAddress, setSaveAddress] = useState(true);
  const [notes, setNotes] = useState('');
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placedOrder, setPlacedOrder] = useState<Order | null>(null);

  // One idempotency key per checkout attempt — reused on retries of the same submit.
  const idempotencyKey = useRef(newIdempotencyKey());

  useEffect(() => {
    track(slug, 'begin_checkout', { itemCount: lines.length, total: totals.total });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    if (!isLoggedIn) return;
    addressAPI
      .list(slug)
      .then((list) => {
        setSavedAddresses(list);
        if (list.length > 0) setSelectedAddressId(list[0].id);
      })
      .catch(() => setSavedAddresses([]));
  }, [slug, isLoggedIn]);

  const effectiveAddress = useMemo<OrderAddress | undefined>(() => {
    if (orderType !== 'delivery') return undefined;
    if (selectedAddressId !== 'new') {
      const saved = savedAddresses.find((a) => a.id === selectedAddressId);
      if (saved) {
        const { id: _id, ...rest } = saved;
        return rest;
      }
    }
    return address;
  }, [orderType, selectedAddressId, savedAddresses, address]);

  if (placedOrder) {
    return (
      <div className="max-w-md mx-auto text-center py-10">
        <div className="w-16 h-16 rounded-full bg-green-100 text-green-600 text-3xl flex items-center justify-center mx-auto mb-4" aria-hidden="true">
          ✓
        </div>
        <h1 className="text-xl font-extrabold text-slate-800 mb-2">Order placed!</h1>
        <p className="text-sm text-slate-600 mb-1">
          Your order <span className="font-bold">{placedOrder.orderNumber}</span> has been received.
        </p>
        <p className="text-xs text-slate-500 mb-6">
          Note: online payment is not live yet — this order was placed with payment stubbed
          (pay on {orderType === 'delivery' ? 'delivery' : 'pickup'}).
        </p>
        <div className="flex flex-col gap-2">
          <Link
            to={`/${slug}/track/${placedOrder.id}`}
            className="w-full py-3 rounded-xl bg-[var(--sf-primary)] text-white font-bold text-sm hover:opacity-90"
          >
            Track this order
          </Link>
          <Link to={`/${slug}/menu`} className="w-full py-3 rounded-xl border border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-50">
            Order more
          </Link>
        </div>
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <EmptyState
        title="Nothing to check out"
        text="Your cart is empty."
        action={
          <Link to={`/${slug}/menu`} className="px-5 py-2.5 rounded-xl bg-[var(--sf-primary)] text-white text-sm font-bold hover:opacity-90">
            Browse menu
          </Link>
        }
      />
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="max-w-md mx-auto">
        <h1 className="text-xl font-extrabold text-slate-800 mb-1">Almost there</h1>
        <p className="text-sm text-slate-500 mb-4">Sign in or create an account to place your order.</p>
        <AuthForms intent="checkout" />
      </div>
    );
  }

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (orderType === 'delivery' && (!effectiveAddress || !effectiveAddress.line1.trim())) {
      setError('Please provide a delivery address.');
      return;
    }

    setPlacing(true);
    try {
      // Optionally save a newly entered delivery address to the account
      if (orderType === 'delivery' && selectedAddressId === 'new' && saveAddress && address.line1.trim()) {
        try {
          await addressAPI.add(slug, {
            line1: address.line1,
            ...(address.line2 ? { line2: address.line2 } : {}),
            ...(address.city ? { city: address.city } : {}),
            ...(address.pincode ? { pincode: address.pincode } : {}),
            ...(address.phone ? { phone: address.phone } : {}),
          });
        } catch { /* non-fatal */ }
      }

      const order = await orderAPI.place(
        slug,
        {
          items: lines.map((l) => ({
            menuItemId: l.menuItemId,
            qty: l.qty,
            ...(l.variant ? { variantId: l.variant.id } : {}),
            ...(l.addons.length > 0 ? { addonIds: l.addons.map((a) => a.id) } : {}),
          })),
          orderType,
          ...(orderType === 'delivery' ? { address: effectiveAddress } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
        idempotencyKey.current,
      );

      track(slug, 'order_placed', { orderId: order.id, total: order.totals.total }, customer?.id);
      clear();
      setPlacedOrder(order);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to place the order');
      // New key for the next distinct attempt after a validation failure
      idempotencyKey.current = newIdempotencyKey();
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-extrabold text-slate-800 mb-4">Checkout</h1>

      {!storeOpen && (
        <p className="mb-4 p-3 rounded-xl bg-red-50 text-red-700 text-sm font-semibold" role="alert">
          The store is currently closed — orders can't be placed right now.
        </p>
      )}

      <form onSubmit={handlePlaceOrder} className="space-y-4">
        {/* Order type */}
        <fieldset className="bg-white rounded-2xl border border-slate-200 p-4">
          <legend className="text-sm font-bold text-slate-700 px-1">How would you like your order?</legend>
          <div className="flex gap-2 mt-2">
            {availableOrderTypes.map((type) => (
              <label
                key={type}
                className={`flex-1 text-center px-3 py-2.5 rounded-xl border text-sm font-bold cursor-pointer ${
                  orderType === type
                    ? 'border-[var(--sf-primary)] bg-orange-50 text-[var(--sf-primary)]'
                    : 'border-slate-200 text-slate-600'
                }`}
              >
                <input
                  type="radio"
                  name="orderType"
                  value={type}
                  checked={orderType === type}
                  onChange={() => setOrderType(type)}
                  className="sr-only"
                />
                {ORDER_TYPE_LABELS[type]}
              </label>
            ))}
          </div>
        </fieldset>

        {/* Delivery address */}
        {orderType === 'delivery' && (
          <fieldset className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
            <legend className="text-sm font-bold text-slate-700 px-1">Delivery address</legend>

            {savedAddresses.length > 0 && (
              <div>
                <label htmlFor="saved-address" className="block text-xs font-bold text-slate-600 mb-1">Saved addresses</label>
                <select
                  id="saved-address"
                  value={selectedAddressId}
                  onChange={(e) => setSelectedAddressId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white"
                >
                  {savedAddresses.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label ? `${a.label} — ` : ''}{a.line1}{a.city ? `, ${a.city}` : ''}
                    </option>
                  ))}
                  <option value="new">+ Use a new address</option>
                </select>
              </div>
            )}

            {selectedAddressId === 'new' && (
              <>
                <div>
                  <label htmlFor="addr-line1" className="block text-xs font-bold text-slate-600 mb-1">Address line 1 *</label>
                  <input
                    id="addr-line1"
                    type="text"
                    required
                    value={address.line1}
                    onChange={(e) => setAddress((a) => ({ ...a, line1: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="addr-line2" className="block text-xs font-bold text-slate-600 mb-1">Address line 2</label>
                  <input
                    id="addr-line2"
                    type="text"
                    value={address.line2 ?? ''}
                    onChange={(e) => setAddress((a) => ({ ...a, line2: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="addr-city" className="block text-xs font-bold text-slate-600 mb-1">City</label>
                    <input
                      id="addr-city"
                      type="text"
                      value={address.city ?? ''}
                      onChange={(e) => setAddress((a) => ({ ...a, city: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="addr-pincode" className="block text-xs font-bold text-slate-600 mb-1">Pincode</label>
                    <input
                      id="addr-pincode"
                      type="text"
                      inputMode="numeric"
                      value={address.pincode ?? ''}
                      onChange={(e) => setAddress((a) => ({ ...a, pincode: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="addr-phone" className="block text-xs font-bold text-slate-600 mb-1">Contact phone</label>
                  <input
                    id="addr-phone"
                    type="tel"
                    value={address.phone ?? ''}
                    onChange={(e) => setAddress((a) => ({ ...a, phone: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                  <input
                    type="checkbox"
                    checked={saveAddress}
                    onChange={(e) => setSaveAddress(e.target.checked)}
                    className="accent-[var(--sf-primary)]"
                  />
                  Save this address to my account
                </label>
              </>
            )}
          </fieldset>
        )}

        {/* Notes */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <label htmlFor="order-notes" className="block text-sm font-bold text-slate-700 mb-2">Order notes</label>
          <textarea
            id="order-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything the kitchen should know?"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
          />
        </div>

        {/* Summary */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <h2 className="text-sm font-bold text-slate-700 mb-3">Order summary</h2>
          <ul className="space-y-1 text-sm text-slate-600 mb-3">
            {lines.map((l) => (
              <li key={l.key} className="flex justify-between gap-2">
                <span className="truncate">
                  {l.qty} × {l.name}{l.variant ? ` (${l.variant.name})` : ''}
                </span>
                <span className="font-medium shrink-0">
                  {formatMoney((l.unitPrice + l.addons.reduce((s, a) => s + a.price, 0)) * l.qty, currency)}
                </span>
              </li>
            ))}
          </ul>
          <dl className="space-y-1 text-sm border-t border-slate-100 pt-2">
            <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd>{formatMoney(totals.subtotal, currency)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Tax</dt><dd>{formatMoney(totals.tax, currency)}</dd></div>
            {orderType === 'delivery' && (
              <div className="flex justify-between"><dt className="text-slate-500">Delivery fee</dt><dd>{formatMoney(totals.deliveryFee, currency)}</dd></div>
            )}
            <div className="flex justify-between font-bold text-slate-800"><dt>Total</dt><dd>{formatMoney(totals.total, currency)}</dd></div>
          </dl>
          <p className="text-xs text-slate-400 mt-2">
            Payment: pay on {orderType === 'delivery' ? 'delivery' : 'pickup'} — online payment coming soon.
          </p>
        </div>

        {orderType === 'delivery' && totals.minOrderShortfall > 0 && (
          <p className="text-sm font-semibold text-amber-600" role="alert">
            Add {formatMoney(totals.minOrderShortfall, currency)} more to reach the delivery minimum of{' '}
            {formatMoney(ordering.delivery?.minOrder ?? 0, currency)}.
          </p>
        )}

        {error && <p className="text-sm text-red-600 font-semibold" role="alert">{error}</p>}

        <button
          type="submit"
          disabled={placing || !storeOpen || (orderType === 'delivery' && totals.minOrderShortfall > 0)}
          className="w-full py-3.5 rounded-2xl bg-[var(--sf-primary)] text-white font-bold text-sm hover:opacity-90 disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          {placing ? 'Placing order…' : `Place order · ${formatMoney(totals.total, currency)}`}
        </button>
      </form>
    </div>
  );
};

export default CheckoutPage;
