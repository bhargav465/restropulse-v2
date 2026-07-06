import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import type { CustomerCohort, CampaignSendRequest, CohortId } from '@restropulse/shared';
import { orderingAdminAPI } from '../../api';
import { ActionNotice } from '../ActionNotice';
import { PanelLoading, PanelError } from './PanelStates';

/**
 * Growth Campaigns — cohort cards with WhatsApp nudge / discount-offer
 * actions. Shared by the v1 Ordering hub tab and the v2 Ordering sub-tab.
 *
 * Server-side, POST /api/admin/ordering/campaigns only *queues* the campaign
 * (status QUEUED + analytics event); actual WhatsApp delivery is the worker
 * seam documented in docs/NEXT.md §9.
 */

interface DiscountFormState {
    percentOff: string;
    code: string;
    expiryDays: string;
}

const DEFAULT_DISCOUNT: DiscountFormState = { percentOff: '15', code: 'COMEBACK15', expiryDays: '7' };

const inputCls =
    'w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/30';

const CohortCard: React.FC<{
    cohort: CustomerCohort;
    onSend: (payload: CampaignSendRequest) => Promise<void>;
    lastSentAt?: string;
}> = ({ cohort, onSend, lastSentAt }) => {
    const [showDiscountForm, setShowDiscountForm] = useState(false);
    const [discount, setDiscount] = useState<DiscountFormState>(DEFAULT_DISCOUNT);
    const [sending, setSending] = useState<'nudge' | 'discount' | null>(null);

    const percentOff = Number(discount.percentOff);
    const expiryDays = Number(discount.expiryDays);
    const discountValid =
        Number.isFinite(percentOff) && percentOff >= 1 && percentOff <= 100 &&
        discount.code.trim().length >= 3 &&
        Number.isInteger(expiryDays) && expiryDays >= 1 && expiryDays <= 90;

    const sendNudge = async () => {
        if (sending) return;
        setSending('nudge');
        try {
            await onSend({ cohortId: cohort.id, kind: 'whatsapp_nudge' });
        } finally {
            setSending(null);
        }
    };

    const sendDiscount = async () => {
        if (sending || !discountValid) return;
        setSending('discount');
        try {
            await onSend({
                cohortId: cohort.id,
                kind: 'discount_offer',
                discount: {
                    percentOff,
                    code: discount.code.trim().toUpperCase(),
                    expiryDays,
                },
            });
            setShowDiscountForm(false);
        } finally {
            setSending(null);
        }
    };

    return (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                    <span className="text-2xl leading-none mt-0.5" aria-hidden="true">{cohort.emoji}</span>
                    <div className="min-w-0">
                        <h3 className="font-bold text-slate-800 text-sm">{cohort.name}</h3>
                        <p className="text-xs text-slate-500 mt-0.5 leading-snug">{cohort.description}</p>
                    </div>
                </div>
                <div className="text-right shrink-0">
                    <p className="text-2xl font-extrabold text-slate-800 leading-none">{cohort.count}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mt-1">customers</p>
                </div>
            </div>

            <div className="flex flex-wrap gap-2 mt-4">
                <button
                    type="button"
                    onClick={sendNudge}
                    disabled={sending !== null || cohort.count === 0}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white shadow-md shadow-emerald-600/20 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none transition-colors active:scale-[0.98]"
                >
                    {sending === 'nudge' ? <RefreshCw size={13} className="animate-spin" aria-hidden="true" /> : <span aria-hidden="true">📲</span>}
                    Send WhatsApp nudge
                </button>
                <button
                    type="button"
                    onClick={() => setShowDiscountForm((v) => !v)}
                    disabled={sending !== null || cohort.count === 0}
                    aria-expanded={showDiscountForm}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 disabled:text-slate-300 transition-colors"
                >
                    <span aria-hidden="true">🎟️</span>
                    Send discount offer
                </button>
            </div>

            {showDiscountForm && (
                <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-slate-100 grid grid-cols-3 gap-2 items-end">
                    <div>
                        <label htmlFor={`discount-pct-${cohort.id}`} className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">% off</label>
                        <input
                            id={`discount-pct-${cohort.id}`}
                            type="number"
                            min={1}
                            max={100}
                            value={discount.percentOff}
                            onChange={(e) => setDiscount((d) => ({ ...d, percentOff: e.target.value }))}
                            className={inputCls}
                        />
                    </div>
                    <div>
                        <label htmlFor={`discount-code-${cohort.id}`} className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Code</label>
                        <input
                            id={`discount-code-${cohort.id}`}
                            type="text"
                            value={discount.code}
                            onChange={(e) => setDiscount((d) => ({ ...d, code: e.target.value.toUpperCase() }))}
                            className={inputCls}
                        />
                    </div>
                    <div>
                        <label htmlFor={`discount-expiry-${cohort.id}`} className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Expiry (days)</label>
                        <input
                            id={`discount-expiry-${cohort.id}`}
                            type="number"
                            min={1}
                            max={90}
                            value={discount.expiryDays}
                            onChange={(e) => setDiscount((d) => ({ ...d, expiryDays: e.target.value }))}
                            className={inputCls}
                        />
                    </div>
                    <button
                        type="button"
                        onClick={sendDiscount}
                        disabled={!discountValid || sending !== null}
                        className="col-span-3 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold bg-orange-600 text-white shadow-md shadow-orange-600/20 hover:bg-orange-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none transition-colors active:scale-[0.98]"
                    >
                        {sending === 'discount' ? <RefreshCw size={13} className="animate-spin" aria-hidden="true" /> : <span aria-hidden="true">🎟️</span>}
                        Queue discount offer
                    </button>
                </div>
            )}

            {lastSentAt && (
                <p className="text-[11px] text-slate-400 mt-3">
                    Last sent {new Date(lastSentAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </p>
            )}
        </div>
    );
};

const Campaigns: React.FC = () => {
    const [cohorts, setCohorts] = useState<CustomerCohort[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
    const [lastSent, setLastSent] = useState<Partial<Record<CohortId, string>>>({});

    const load = useCallback(async () => {
        setCohorts(null);
        setError(null);
        try {
            const data = await orderingAdminAPI.getCohorts();
            setCohorts(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load customer cohorts');
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // Auto-dismiss notice
    useEffect(() => {
        if (!notice) return;
        const timer = setTimeout(() => setNotice(null), 5000);
        return () => clearTimeout(timer);
    }, [notice]);

    const handleSend = async (payload: CampaignSendRequest) => {
        try {
            const result = await orderingAdminAPI.sendCampaign(payload);
            setLastSent((prev) => ({ ...prev, [payload.cohortId]: new Date().toISOString() }));
            setNotice({ message: `Queued for ${result.audienceCount} customers ✅`, type: 'success' });
        } catch (err) {
            setNotice({ message: err instanceof Error ? err.message : 'Failed to queue the campaign', type: 'error' });
        }
    };

    if (error) return <PanelError message={error} onRetry={load} />;
    if (cohorts === null) return <PanelLoading label="Computing customer cohorts…" />;

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <span aria-hidden="true">📣</span> Growth Campaigns
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                    Win back customers with a WhatsApp nudge or a targeted discount.
                </p>
                <p className="text-[11px] text-slate-400 mt-1.5 flex items-center gap-1.5">
                    <ShieldCheck size={13} className="text-emerald-500 shrink-0" aria-hidden="true" />
                    Messages go only to opted-in customers.
                </p>
            </div>

            {notice && <ActionNotice message={notice.message} type={notice.type} />}

            <div className="space-y-3">
                {cohorts.map((cohort) => (
                    <CohortCard key={cohort.id} cohort={cohort} onSend={handleSend} lastSentAt={lastSent[cohort.id]} />
                ))}
            </div>
        </div>
    );
};

export default Campaigns;
