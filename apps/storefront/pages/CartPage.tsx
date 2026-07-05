import React, { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../store/CartContext';
import { useStorefront } from '../store/StorefrontContext';
import { formatMoney } from '../lib/format';
import { lineTotal, MAX_QTY_PER_LINE } from '../lib/cart';
import { track } from '../lib/analytics';
import { EmptyState } from '../components/States';

const CartPage: React.FC = () => {
  const { slug, currency, ordering } = useStorefront();
  const { lines, totals, setQty, remove, orderType } = useCart();
  const navigate = useNavigate();

  useEffect(() => {
    track(slug, 'view_cart', { itemCount: lines.length });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  if (lines.length === 0) {
    return (
      <EmptyState
        title="Your cart is empty"
        text="Add something delicious from the menu."
        action={
          <Link to={`/${slug}/menu`} className="px-5 py-2.5 rounded-xl bg-[var(--sf-primary)] text-white text-sm font-bold hover:opacity-90">
            Browse menu
          </Link>
        }
      />
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-extrabold text-slate-800 mb-4">Your cart</h1>

      <ul className="space-y-3 mb-6">
        {lines.map((line) => (
          <li key={line.key} className="bg-white rounded-2xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <span
                    className={`inline-block w-3 h-3 border-2 rounded-sm shrink-0 ${line.isVeg ? 'border-green-600' : 'border-red-600'}`}
                    role="img"
                    aria-label={line.isVeg ? 'Vegetarian' : 'Non-vegetarian'}
                  ></span>
                  {line.name}
                  {line.variant && <span className="text-xs font-medium text-slate-500">({line.variant.name})</span>}
                </p>
                {line.addons.length > 0 && (
                  <p className="text-xs text-slate-500 mt-1">
                    Add-ons: {line.addons.map((a) => `${a.name} (+${formatMoney(a.price, currency)})`).join(', ')}
                  </p>
                )}
                <p className="text-sm font-semibold text-slate-700 mt-1.5">{formatMoney(lineTotal(line), currency)}</p>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <div className="flex items-center border border-slate-200 rounded-xl" role="group" aria-label={`Quantity for ${line.name}`}>
                  <button
                    onClick={() => setQty(line.key, line.qty - 1)}
                    aria-label={`Decrease quantity of ${line.name}`}
                    className="w-9 h-9 font-bold text-slate-600 hover:bg-slate-50 rounded-l-xl"
                  >
                    −
                  </button>
                  <span className="w-7 text-center text-sm font-bold" aria-live="polite">{line.qty}</span>
                  <button
                    onClick={() => setQty(line.key, Math.min(MAX_QTY_PER_LINE, line.qty + 1))}
                    aria-label={`Increase quantity of ${line.name}`}
                    className="w-9 h-9 font-bold text-slate-600 hover:bg-slate-50 rounded-r-xl"
                  >
                    +
                  </button>
                </div>
                <button
                  onClick={() => remove(line.key)}
                  className="text-xs font-semibold text-red-600 hover:underline"
                >
                  Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* Coupon (UI only in v1) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-4">
        <label htmlFor="coupon" className="block text-xs font-bold text-slate-600 mb-1">Coupon code</label>
        <div className="flex gap-2">
          <input
            id="coupon"
            type="text"
            disabled
            placeholder="Coupons coming soon"
            className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-400"
          />
          <button disabled className="px-4 py-2.5 rounded-xl bg-slate-200 text-slate-400 text-sm font-bold cursor-not-allowed">
            Apply
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-1.5">Coupons are not available yet — they're on the way.</p>
      </div>

      {/* Totals breakdown */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-4" aria-label="Bill details">
        <h2 className="text-sm font-bold text-slate-700 mb-3">Bill details</h2>
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Subtotal</dt>
            <dd className="font-medium text-slate-700">{formatMoney(totals.subtotal, currency)}</dd>
          </div>
          {(ordering.taxRatePercent ?? 0) > 0 && (
            <div className="flex justify-between">
              <dt className="text-slate-500">Tax ({ordering.taxRatePercent}%)</dt>
              <dd className="font-medium text-slate-700">{formatMoney(totals.tax, currency)}</dd>
            </div>
          )}
          {orderType === 'delivery' && (
            <div className="flex justify-between">
              <dt className="text-slate-500">Delivery fee</dt>
              <dd className="font-medium text-slate-700">{formatMoney(totals.deliveryFee, currency)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-slate-100 pt-2 mt-2">
            <dt className="font-bold text-slate-800">Total</dt>
            <dd className="font-bold text-slate-800">{formatMoney(totals.total, currency)}</dd>
          </div>
        </dl>
        {orderType === 'delivery' && totals.minOrderShortfall > 0 && (
          <p className="text-xs font-semibold text-amber-600 mt-2" role="status">
            Add {formatMoney(totals.minOrderShortfall, currency)} more to reach the delivery minimum.
          </p>
        )}
      </div>

      <button
        onClick={() => navigate(`/${slug}/checkout`)}
        className="w-full py-3.5 rounded-2xl bg-[var(--sf-primary)] text-white font-bold text-sm hover:opacity-90"
      >
        Proceed to checkout
      </button>
    </div>
  );
};

export default CartPage;
