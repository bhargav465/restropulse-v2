import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import type { Order } from '@restropulse/shared';
import { useStorefront } from '../store/StorefrontContext';
import { useAuth } from '../store/AuthContext';
import { orderAPI, paymentAPI } from '../api';
import { formatMoney } from '../lib/format';
import { isDemoMode } from '../lib/demo';
import { loadRazorpayScript } from '../lib/razorpay';
import AuthForms from '../components/AuthForms';
import { Loading, ErrorState } from '../components/States';

type Phase = 'idle' | 'processing' | 'failed' | 'success';

/** Statuses at/after payment capture — the order no longer needs paying. */
function isAwaitingPayment(status: string): boolean {
  return status === 'PENDING_PAYMENT' || status === 'PAYMENT_FAILED';
}

const PaymentPage: React.FC = () => {
  const { slug, currency, restaurantName } = useStorefront();
  const { orderId } = useParams<{ orderId: string }>();
  const { isLoggedIn, customer } = useAuth();
  const navigate = useNavigate();

  const [order, setOrder] = useState<Order | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [payError, setPayError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId || !isLoggedIn) return;
    let cancelled = false;
    setLoadError(null);
    orderAPI
      .get(slug, orderId)
      .then((o) => { if (!cancelled) setOrder(o); })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load your order');
      });
    return () => { cancelled = true; };
  }, [slug, orderId, isLoggedIn, reloadKey]);

  if (!orderId) return <Navigate to={`/${slug}/menu`} replace />;

  // Payment requires an authenticated customer (the order is scoped to them).
  if (!isLoggedIn) {
    return (
      <div className="max-w-md mx-auto">
        <h1 className="text-xl font-extrabold text-slate-800 mb-1">Sign in to pay</h1>
        <p className="text-sm text-slate-500 mb-4">Sign in to complete payment for your order.</p>
        <AuthForms intent="checkout" />
      </div>
    );
  }

  if (loadError) {
    return <ErrorState message={loadError} onRetry={() => { setLoadError(null); setReloadKey((k) => k + 1); }} />;
  }
  if (!order) return <Loading label="Loading your order…" />;

  // Already paid / advanced (or cancelled): nothing to pay — go to tracking.
  if (!isAwaitingPayment(order.status)) {
    return <Navigate to={`/${slug}/track/${orderId}`} replace />;
  }

  const startPayment = async () => {
    setPayError(null);
    setPhase('processing');
    try {
      const intent = await paymentAPI.createIntent(slug, orderId);

      // Demo mode: no script, no razorpay.com — just simulate a captured payment.
      if (isDemoMode()) {
        await paymentAPI.verify(slug, {
          orderId,
          razorpayPaymentId: `demo_pay_${intent.providerOrderId}`,
          razorpayOrderId: intent.providerOrderId,
          razorpaySignature: 'demo_signature',
        });
        setPhase('success');
        navigate(`/${slug}/track/${orderId}`);
        return;
      }

      await loadRazorpayScript();
      if (!window.Razorpay) throw new Error('Payment could not be started');

      const rzp = new window.Razorpay({
        key: intent.keyId,
        order_id: intent.providerOrderId,
        amount: intent.amount,
        currency: intent.currency,
        name: restaurantName || 'Order payment',
        description: `Order ${order.orderNumber}`,
        prefill: {
          ...(customer?.name ? { name: customer.name } : {}),
          ...(customer?.email ? { email: customer.email } : {}),
          ...(customer?.phone ? { contact: customer.phone } : {}),
        },
        theme: { color: getComputedStyle(document.documentElement).getPropertyValue('--sf-primary').trim() || undefined },
        handler: async (response) => {
          try {
            await paymentAPI.verify(slug, {
              orderId,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpayOrderId: response.razorpay_order_id,
              razorpaySignature: response.razorpay_signature,
            });
            setPhase('success');
            navigate(`/${slug}/track/${orderId}`);
          } catch (err) {
            setPayError(err instanceof Error ? err.message : 'We could not confirm your payment.');
            setPhase('failed');
          }
        },
        modal: {
          ondismiss: () => {
            setPayError('Payment was not completed. You can try again.');
            setPhase('failed');
          },
        },
      });
      rzp.on('payment.failed', (response) => {
        setPayError(response.error?.description ?? 'Your payment failed. Please try again.');
        setPhase('failed');
      });
      rzp.open();
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Payment could not be started.');
      setPhase('failed');
    }
  };

  const { totals, items } = order;

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-xl font-extrabold text-slate-800 mb-1">Complete your payment</h1>
      <p className="text-sm text-slate-500 mb-4">
        Order <span className="font-bold">{order.orderNumber}</span>
      </p>

      {phase === 'success' && (
        <p className="mb-4 p-3 rounded-xl bg-green-50 text-green-700 text-sm font-semibold" role="status">
          Payment successful — taking you to order tracking…
        </p>
      )}

      {phase === 'failed' && payError && (
        <p className="mb-4 p-3 rounded-xl bg-red-50 text-red-700 text-sm font-semibold" role="alert">
          {payError}
        </p>
      )}

      {/* Order summary — server values only */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-4">
        <h2 className="text-sm font-bold text-slate-700 mb-3">Order summary</h2>
        <ul className="space-y-1 text-sm text-slate-600 mb-3">
          {items.map((line, idx) => (
            <li key={`${line.menuItemId}-${idx}`} className="flex justify-between gap-2">
              <span className="truncate">
                {line.qty} × {line.name}{line.variant ? ` (${line.variant.name})` : ''}
              </span>
              <span className="font-medium shrink-0">{formatMoney(line.lineTotal, currency)}</span>
            </li>
          ))}
        </ul>
        <dl className="space-y-1 text-sm border-t border-slate-100 pt-2">
          <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd>{formatMoney(totals.subtotal, currency)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Tax</dt><dd>{formatMoney(totals.tax, currency)}</dd></div>
          {totals.deliveryFee > 0 && (
            <div className="flex justify-between"><dt className="text-slate-500">Delivery fee</dt><dd>{formatMoney(totals.deliveryFee, currency)}</dd></div>
          )}
          {totals.discount > 0 && (
            <div className="flex justify-between text-emerald-600"><dt>Discount</dt><dd>−{formatMoney(totals.discount, currency)}</dd></div>
          )}
          <div className="flex justify-between font-bold text-slate-800"><dt>Total</dt><dd>{formatMoney(totals.total, currency)}</dd></div>
        </dl>
      </div>

      <button
        type="button"
        onClick={startPayment}
        disabled={phase === 'processing' || phase === 'success'}
        className="w-full py-3.5 rounded-2xl bg-[var(--sf-primary)] text-white font-bold text-sm hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {phase === 'processing'
          ? 'Processing…'
          : phase === 'failed'
            ? `Try again · ${formatMoney(totals.total, currency)}`
            : `Pay ${formatMoney(totals.total, currency)}`}
      </button>

      <p className="text-xs text-slate-400 mt-3 text-center">
        {isDemoMode()
          ? 'Demo mode — payment is simulated, no money moves.'
          : 'Payments are securely processed by Razorpay.'}
      </p>
    </div>
  );
};

export default PaymentPage;
