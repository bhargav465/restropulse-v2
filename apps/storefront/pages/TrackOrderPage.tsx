import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useStorefront } from '../store/StorefrontContext';
import { orderAPI } from '../api';
import type { OrderTrackingInfo } from '../types';
import { formatDate } from '../lib/format';
import { Loading, ErrorState } from '../components/States';

const POLL_INTERVAL_MS = 10_000;

const STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: 'Payment pending',
  RECEIVED: 'Order received',
  PREPARING: 'Being prepared',
  READY: 'Ready',
  OUT_FOR_DELIVERY: 'Out for delivery',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

function expectedFlow(orderType: string): string[] {
  return orderType === 'delivery'
    ? ['RECEIVED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'COMPLETED']
    : ['RECEIVED', 'PREPARING', 'READY', 'COMPLETED'];
}

const TrackOrderPage: React.FC = () => {
  const { slug } = useStorefront();
  const { orderId } = useParams<{ orderId: string }>();
  const [searchParams] = useSearchParams();
  const [info, setInfo] = useState<OrderTrackingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const orderNumber = searchParams.get('orderNumber');
  const phone = searchParams.get('phone');

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const fetchStatus = async () => {
      try {
        const data = await orderAPI.track(
          slug,
          orderId,
          orderNumber && phone ? { orderNumber, phone } : undefined,
        );
        if (cancelled) return;
        setInfo(data);
        setError(null);
        // Keep polling while the order is still moving
        if (!['COMPLETED', 'CANCELLED'].includes(data.status)) {
          timer = setTimeout(fetchStatus, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load order status');
      }
    };

    fetchStatus();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [slug, orderId, orderNumber, phone, reloadKey]);

  if (error) {
    return <ErrorState message={error} onRetry={() => { setError(null); setReloadKey((k) => k + 1); }} />;
  }
  if (!info) return <Loading label="Loading order status…" />;

  const reachedStatuses = new Set(info.statusHistory.map((h) => h.status));
  const flow = expectedFlow(info.orderType);
  const cancelled = info.status === 'CANCELLED';

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-xl font-extrabold text-slate-800 mb-1">Order {info.orderNumber}</h1>
      <p className="text-sm text-slate-500 mb-6">
        Placed {formatDate(info.placedAt)} · {info.orderType.replace('_', '-')}
      </p>

      {cancelled && (
        <p className="mb-4 p-3 rounded-xl bg-red-50 text-red-700 text-sm font-semibold" role="alert">
          This order was cancelled.
        </p>
      )}

      {/* Status timeline */}
      <ol className="relative space-y-0" aria-label="Order status timeline">
        {flow.map((status, idx) => {
          const historyEntry = [...info.statusHistory].reverse().find((h) => h.status === status);
          const reached = reachedStatuses.has(status);
          const isCurrent = info.status === status;
          return (
            <li key={status} className="flex gap-3 pb-6 last:pb-0 relative">
              {idx < flow.length - 1 && (
                <span
                  className={`absolute left-[11px] top-6 bottom-0 w-0.5 ${reached ? 'bg-[var(--sf-primary)]' : 'bg-slate-200'}`}
                  aria-hidden="true"
                ></span>
              )}
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 z-10 ${
                  reached ? 'bg-[var(--sf-primary)] text-white' : 'bg-slate-200 text-slate-400'
                } ${isCurrent ? 'ring-4 ring-orange-100' : ''}`}
                aria-hidden="true"
              >
                {reached ? '✓' : idx + 1}
              </span>
              <div>
                <p className={`text-sm font-bold ${reached ? 'text-slate-800' : 'text-slate-400'}`}>
                  {STATUS_LABELS[status] ?? status}
                  {isCurrent && !cancelled && <span className="sr-only"> (current status)</span>}
                </p>
                {historyEntry && (
                  <p className="text-xs text-slate-500">
                    {formatDate(historyEntry.at)}
                    {historyEntry.note ? ` — ${historyEntry.note}` : ''}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <p className="text-xs text-slate-400 mt-6" role="status">
        {['COMPLETED', 'CANCELLED'].includes(info.status)
          ? 'This order is finished.'
          : 'Status refreshes automatically every 10 seconds.'}
      </p>

      <Link to={`/${slug}/account`} className="inline-block mt-4 text-sm font-semibold text-[var(--sf-primary)] hover:underline">
        View all my orders →
      </Link>
    </div>
  );
};

export default TrackOrderPage;
