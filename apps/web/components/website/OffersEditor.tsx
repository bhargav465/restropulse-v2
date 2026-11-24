import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import type { OfferReward, OfferStatus, Weekday } from '@restropulse/shared';
import { WEEKDAYS } from '@restropulse/shared';
import { cmsAPI, type CmsOffer, type CmsOfferInput } from '../../api';
import { Badge, Button, Card, SectionHeader } from '../ui';

const inputClass = 'w-full rounded-xl border border-[var(--rp-line)] bg-[var(--rp-surface)] px-3 py-2 text-sm text-[var(--rp-text)]';

const STATUS_LABELS: Record<OfferStatus, string> = { draft: 'Draft', active: 'Active', paused: 'Paused', archived: 'Archived' };
const DAY_LABELS: Record<Weekday, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

type RewardKind = OfferReward['kind'];

interface OfferDraft {
    id?: string;
    title: string;
    description: string;
    rewardKind: RewardKind;
    percent: string;
    maxDiscount: string;
    amount: string;
    minOrderValue: string;
    code: string;
    startsOn: string;
    endsOn: string;
    days: Weekday[];
    from: string;
    to: string;
    showOnSite: boolean;
    promoteInContent: boolean;
    status: OfferStatus;
}

const today = () => new Date().toISOString().slice(0, 10);

const emptyDraft = (): OfferDraft => ({
    title: '', description: '', rewardKind: 'percent_off', percent: '10', maxDiscount: '', amount: '', minOrderValue: '', code: '',
    startsOn: today(), endsOn: '', days: [], from: '', to: '', showOnSite: true, promoteInContent: true, status: 'draft',
});

const toDraft = (offer: CmsOffer): OfferDraft => ({
    id: offer.id,
    title: offer.title,
    description: offer.description ?? '',
    rewardKind: offer.reward.kind,
    percent: offer.reward.kind === 'percent_off' ? String(offer.reward.percent) : '10',
    maxDiscount: offer.reward.kind === 'percent_off' && offer.reward.maxDiscount ? String(offer.reward.maxDiscount) : '',
    amount: offer.reward.kind === 'flat_off' ? String(offer.reward.amount) : '',
    minOrderValue: offer.minOrderValue ? String(offer.minOrderValue) : '',
    code: offer.code ?? '',
    startsOn: offer.schedule.startsAt.slice(0, 10),
    endsOn: offer.schedule.endsAt?.slice(0, 10) ?? '',
    days: offer.schedule.days ?? [],
    from: offer.schedule.from ?? '',
    to: offer.schedule.to ?? '',
    showOnSite: offer.showOnSite,
    promoteInContent: offer.promoteInContent,
    status: offer.status,
});

/** Turn the form into an API body, or return an error message to show. */
export function draftToInput(draft: OfferDraft): CmsOfferInput | string {
    if (!draft.title.trim()) return 'Give the offer a name.';
    let reward: OfferReward;
    if (draft.rewardKind === 'percent_off') {
        const percent = Number(draft.percent);
        if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return 'Percent off must be between 1 and 100.';
        reward = { kind: 'percent_off', percent, ...(draft.maxDiscount ? { maxDiscount: Number(draft.maxDiscount) } : {}) };
    } else if (draft.rewardKind === 'flat_off') {
        const amount = Number(draft.amount);
        if (!Number.isFinite(amount) || amount <= 0) return 'Enter the amount off in rupees.';
        reward = { kind: 'flat_off', amount };
    } else {
        reward = { kind: 'free_delivery' };
    }
    if (Boolean(draft.from) !== Boolean(draft.to)) return 'Give both a start and an end time, or neither.';
    if (!draft.startsOn) return 'Pick a start date.';

    return {
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        reward,
        minOrderValue: draft.minOrderValue ? Number(draft.minOrderValue) : null,
        code: draft.code.trim() || null,
        // null clears an end date or daily window that an earlier save set.
        schedule: {
            startsAt: draft.startsOn,
            endsAt: draft.endsOn || null,
            days: draft.days,
            from: draft.from || null,
            to: draft.to || null,
        },
        showOnSite: draft.showOnSite,
        promoteInContent: draft.promoteInContent,
        status: draft.status,
    };
}

const statusTone = (offer: CmsOffer) =>
    offer.status === 'active' ? (offer.live ? 'success' : 'warning') : offer.status === 'paused' ? 'warning' : 'muted';

const OffersEditor: React.FC = () => {
    const [offers, setOffers] = useState<CmsOffer[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [draft, setDraft] = useState<OfferDraft | null>(null);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        try {
            setOffers(await cmsAPI.getOffers());
            setError(null);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const save = async () => {
        if (!draft) return;
        const input = draftToInput(draft);
        if (typeof input === 'string') return setError(input);
        setSaving(true);
        try {
            setError(null);
            if (draft.id) await cmsAPI.updateOffer(draft.id, input);
            else await cmsAPI.createOffer(input);
            setDraft(null);
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setSaving(false);
        }
    };

    const remove = async (offer: CmsOffer) => {
        if (!window.confirm(`Delete "${offer.title}"?`)) return;
        try {
            await cmsAPI.deleteOffer(offer.id);
            await load();
        } catch (e) {
            setError((e as Error).message);
        }
    };

    const toggleDay = (day: Weekday) => {
        if (!draft) return;
        setDraft({ ...draft, days: draft.days.includes(day) ? draft.days.filter((d) => d !== day) : [...draft.days, day] });
    };

    if (loading) return <p className="text-sm text-[var(--rp-muted)]">Loading your offers…</p>;

    return (
        <div className="space-y-5">
            <SectionHeader
                title="Offers"
                subtitle="Active offers show on your website and can be promoted in your posts."
                right={<Button onClick={() => setDraft(emptyDraft())}><span className="inline-flex items-center gap-1"><Plus size={16} /> New offer</span></Button>}
            />
            {error && <p role="alert" className="text-sm font-medium text-[var(--rp-danger)]">{error}</p>}

            {offers.length === 0 && !draft && (
                <Card><p className="text-sm text-[var(--rp-muted)]">No offers yet. Add one to show it on your website.</p></Card>
            )}

            {offers.map((offer) => (
                <Card key={offer.id} className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 font-semibold text-[var(--rp-text)]">
                            {offer.title}
                            <Badge tone={statusTone(offer)}>{offer.status === 'active' && !offer.live ? 'Scheduled' : STATUS_LABELS[offer.status]}</Badge>
                        </p>
                        <p className="mt-0.5 text-sm text-[var(--rp-muted)]">{offer.summary}</p>
                    </div>
                    <button type="button" aria-label={`Edit ${offer.title}`} onClick={() => setDraft(toDraft(offer))}
                        className="rounded-lg p-2 text-[var(--rp-muted)] hover:text-[var(--rp-text)]"><Pencil size={16} /></button>
                    <button type="button" aria-label={`Delete ${offer.title}`} onClick={() => void remove(offer)}
                        className="rounded-lg p-2 text-[var(--rp-muted)] hover:text-[var(--rp-danger)]"><Trash2 size={16} /></button>
                </Card>
            ))}

            {draft && (
                <Card className="space-y-3">
                    <h3 className="font-bold text-[var(--rp-text)]">{draft.id ? 'Edit offer' : 'New offer'}</h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-xs font-semibold text-[var(--rp-muted)]">Name
                            <input className={inputClass} value={draft.title} placeholder="Weekday lunch" onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                        </label>
                        <label className="text-xs font-semibold text-[var(--rp-muted)]">Status
                            <select className={inputClass} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as OfferStatus })}>
                                {(Object.keys(STATUS_LABELS) as OfferStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                            </select>
                        </label>
                        <label className="text-xs font-semibold text-[var(--rp-muted)]">What it gives
                            <select className={inputClass} value={draft.rewardKind} onChange={(e) => setDraft({ ...draft, rewardKind: e.target.value as RewardKind })}>
                                <option value="percent_off">Percent off</option>
                                <option value="flat_off">Rupees off</option>
                                <option value="free_delivery">Free delivery</option>
                            </select>
                        </label>
                        {draft.rewardKind === 'percent_off' && (
                            <div className="grid grid-cols-2 gap-2">
                                <label className="text-xs font-semibold text-[var(--rp-muted)]">Percent
                                    <input className={inputClass} inputMode="numeric" value={draft.percent} onChange={(e) => setDraft({ ...draft, percent: e.target.value })} />
                                </label>
                                <label className="text-xs font-semibold text-[var(--rp-muted)]">Up to ₹ (optional)
                                    <input className={inputClass} inputMode="numeric" value={draft.maxDiscount} onChange={(e) => setDraft({ ...draft, maxDiscount: e.target.value })} />
                                </label>
                            </div>
                        )}
                        {draft.rewardKind === 'flat_off' && (
                            <label className="text-xs font-semibold text-[var(--rp-muted)]">Amount off (₹)
                                <input className={inputClass} inputMode="numeric" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
                            </label>
                        )}
                        <label className="text-xs font-semibold text-[var(--rp-muted)]">Minimum order ₹ (optional)
                            <input className={inputClass} inputMode="numeric" value={draft.minOrderValue} onChange={(e) => setDraft({ ...draft, minOrderValue: e.target.value })} />
                        </label>
                        <label className="text-xs font-semibold text-[var(--rp-muted)]">Coupon code (optional)
                            <input className={inputClass} value={draft.code} placeholder="LUNCH15" onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} />
                        </label>
                        <label className="text-xs font-semibold text-[var(--rp-muted)]">Starts
                            <input type="date" className={inputClass} value={draft.startsOn} onChange={(e) => setDraft({ ...draft, startsOn: e.target.value })} />
                        </label>
                        <label className="text-xs font-semibold text-[var(--rp-muted)]">Ends (optional)
                            <input type="date" className={inputClass} value={draft.endsOn} onChange={(e) => setDraft({ ...draft, endsOn: e.target.value })} />
                        </label>
                        <label className="text-xs font-semibold text-[var(--rp-muted)]">Daily from (optional)
                            <input type="time" className={inputClass} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
                        </label>
                        <label className="text-xs font-semibold text-[var(--rp-muted)]">Daily until
                            <input type="time" className={inputClass} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
                        </label>
                    </div>
                    <fieldset className="space-y-1">
                        <legend className="text-xs font-semibold text-[var(--rp-muted)]">Days (none picked means every day)</legend>
                        <div className="flex flex-wrap gap-1">
                            {WEEKDAYS.map((day) => (
                                <button key={day} type="button" aria-pressed={draft.days.includes(day)} onClick={() => toggleDay(day)}
                                    className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${draft.days.includes(day)
                                        ? 'border-[var(--rp-primary)] bg-[color-mix(in_srgb,var(--rp-primary)_14%,transparent)] text-[var(--rp-primary)]'
                                        : 'border-[var(--rp-line)] text-[var(--rp-muted)]'}`}>
                                    {DAY_LABELS[day]}
                                </button>
                            ))}
                        </div>
                    </fieldset>
                    <label className="block text-xs font-semibold text-[var(--rp-muted)]">Description (optional)
                        <textarea className={inputClass} rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                    </label>
                    <div className="flex flex-wrap gap-4 text-sm text-[var(--rp-text)]">
                        <label className="flex items-center gap-2"><input type="checkbox" checked={draft.showOnSite}
                            onChange={(e) => setDraft({ ...draft, showOnSite: e.target.checked })} /> Show on my website</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={draft.promoteInContent}
                            onChange={(e) => setDraft({ ...draft, promoteInContent: e.target.checked })} /> Promote in my posts</label>
                    </div>
                    <div className="flex gap-2">
                        <Button onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save offer'}</Button>
                        <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
                    </div>
                </Card>
            )}
        </div>
    );
};

export default OffersEditor;
