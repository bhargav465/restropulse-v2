import React, { useEffect, useState } from 'react';
import type { DeliveryProviderId, DeliveryStrategy, RestaurantDeliverySettings } from '@restropulse/shared';
import { deliveryAPI, type DeliverySettingsView } from '../../api';
import { Button, Card, SectionHeader } from '../ui';

const selectClass = 'rounded-xl border border-[var(--rp-line)] bg-[var(--rp-surface)] px-3 py-2 text-sm text-[var(--rp-text)]';

const STRATEGY_LABELS: Record<DeliveryStrategy, string> = {
    preferred: 'In my order of preference',
    cheapest: 'Cheapest first',
    fastest: 'Fastest first',
};

/** Partners first (in the order shown), own riders always last as the fallback. */
export function withOwnRidersLast(partners: DeliveryProviderId[]): DeliveryProviderId[] {
    return [...partners.filter((p) => p !== 'self'), 'self'];
}

/**
 * Rider dispatch settings (Phase 2 M4): book riders automatically for delivery
 * orders, when, and which partners to try. Own riders are always the fallback.
 */
const DeliverySettings: React.FC = () => {
    const [view, setView] = useState<DeliverySettingsView | null>(null);
    const [form, setForm] = useState<RestaurantDeliverySettings | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        deliveryAPI.getSettings()
            .then((v) => { setView(v); setForm(v.settings); })
            .catch((e: Error) => setError(e.message));
    }, []);

    if (!view || !form) {
        return error ? <p role="alert" className="text-sm font-medium text-[var(--rp-danger)]">{error}</p> : <p className="text-sm text-[var(--rp-muted)]">Loading delivery settings…</p>;
    }

    const partners = view.providers.filter((p) => p.kind === 'partner');
    const set = <K extends keyof RestaurantDeliverySettings>(k: K, v: RestaurantDeliverySettings[K]) => {
        setSaved(false);
        setForm({ ...form, [k]: v });
    };
    const togglePartner = (id: DeliveryProviderId, on: boolean) => {
        const chosen = partners.map((p) => p.id).filter((p) => (p === id ? on : form.providers.includes(p)));
        set('providers', withOwnRidersLast(chosen));
    };

    const save = async () => {
        setSaving(true);
        try {
            const next = await deliveryAPI.saveSettings({ ...form, providers: withOwnRidersLast(form.providers) });
            setView(next);
            setForm(next.settings);
            setError(null);
            setSaved(true);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            <SectionHeader title="Riders" subtitle="Who delivers your delivery orders." />
            {error && <p role="alert" className="text-sm font-medium text-[var(--rp-danger)]">{error}</p>}
            {saved && <p role="status" className="text-sm font-medium text-[var(--rp-success)]">Rider settings saved.</p>}
            <Card className="space-y-3">
                <label className="flex items-start gap-2 text-sm text-[var(--rp-text)]">
                    <input type="checkbox" className="mt-1" checked={form.dispatchEnabled} onChange={(e) => set('dispatchEnabled', e.target.checked)} />
                    <span>
                        <span className="font-medium">Book a rider automatically</span>
                        <span className="block text-xs text-[var(--rp-muted)]">Off: you find a rider from each order yourself.</span>
                    </span>
                </label>
                <label className="block text-sm text-[var(--rp-text)]">
                    Book when the order is
                    <select aria-label="Book when the order is" className={`${selectClass} mt-1 block`} value={form.dispatchAt} onChange={(e) => set('dispatchAt', e.target.value as RestaurantDeliverySettings['dispatchAt'])}>
                        <option value="READY">Ready (partners may charge for waiting otherwise)</option>
                        <option value="PREPARING">Being prepared (rider arrives sooner)</option>
                    </select>
                </label>
            </Card>
            <Card className="space-y-3">
                <p className="text-sm font-medium text-[var(--rp-text)]">Delivery partners</p>
                {partners.length === 0 && (
                    <p className="text-sm text-[var(--rp-muted)]">No delivery partner is connected yet, so your own riders take every order.</p>
                )}
                {partners.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm text-[var(--rp-text)]">
                        <input type="checkbox" checked={form.providers.includes(p.id)} onChange={(e) => togglePartner(p.id, e.target.checked)} />
                        {p.label}
                    </label>
                ))}
                <label className="flex items-center gap-2 text-sm text-[var(--rp-muted)]">
                    <input type="checkbox" checked disabled />
                    Your own riders (always the fallback)
                </label>
                {partners.length > 1 && (
                    <label className="block text-sm text-[var(--rp-text)]">
                        Choose a partner
                        <select aria-label="Choose a partner" className={`${selectClass} mt-1 block`} value={form.strategy} onChange={(e) => set('strategy', e.target.value as DeliveryStrategy)}>
                            {(Object.keys(STRATEGY_LABELS) as DeliveryStrategy[]).map((s) => <option key={s} value={s}>{STRATEGY_LABELS[s]}</option>)}
                        </select>
                    </label>
                )}
            </Card>
            <Button disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save rider settings'}</Button>
        </div>
    );
};

export default DeliverySettings;
