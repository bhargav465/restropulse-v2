import React, { useEffect, useState } from 'react';
import type { RestaurantOrderingSettings } from '@restropulse/shared';
import { isValidRestaurantSlug } from '@restropulse/shared';
import { ordersAPI, type OrderingSettingsView } from '../../api';
import { Button, Card, SectionHeader } from '../ui';

const inputClass = 'w-full rounded-xl border border-[var(--rp-line)] bg-[var(--rp-surface)] px-3 py-2 text-sm text-[var(--rp-text)]';

interface SettingsForm {
    slug: string;
    storeOpen: boolean;
    taxRatePercent: string;
    deliveryEnabled: boolean;
    flatFee: string;
    minOrder: string;
    freeAbove: string;
    pickupEnabled: boolean;
    dineInEnabled: boolean;
    cashAccepted: boolean;
}

export const toForm = (view: OrderingSettingsView): SettingsForm => ({
    slug: view.slug ?? view.suggestedSlug,
    storeOpen: view.ordering.storeOpen,
    taxRatePercent: String(view.ordering.taxRatePercent),
    deliveryEnabled: view.ordering.delivery.enabled,
    flatFee: String(view.ordering.delivery.flatFee),
    minOrder: String(view.ordering.delivery.minOrder),
    freeAbove: view.ordering.delivery.freeAbove !== undefined ? String(view.ordering.delivery.freeAbove) : '',
    pickupEnabled: view.ordering.pickup.enabled,
    dineInEnabled: view.ordering.dineIn.enabled,
    cashAccepted: view.ordering.cashAccepted,
});

/** Turn the form into the API body, or return an error message to show. */
export function fromForm(form: SettingsForm): { slug: string; ordering: RestaurantOrderingSettings } | string {
    const slug = form.slug.trim().toLowerCase();
    if (!isValidRestaurantSlug(slug)) return 'Use 3 to 48 lowercase letters, numbers and single hyphens for the web address.';
    const num = (v: string, label: string): number | string => {
        const n = Number(v.trim() === '' ? NaN : v);
        return Number.isFinite(n) && n >= 0 ? n : `${label} must be a number of 0 or more.`;
    };
    const tax = num(form.taxRatePercent, 'Tax');
    const flatFee = num(form.flatFee, 'The delivery fee');
    const minOrder = num(form.minOrder, 'The delivery minimum');
    const freeAbove = form.freeAbove.trim() === '' ? undefined : num(form.freeAbove, 'Free delivery above');
    for (const v of [tax, flatFee, minOrder, freeAbove]) if (typeof v === 'string') return v;
    return {
        slug,
        ordering: {
            storeOpen: form.storeOpen,
            taxRatePercent: tax as number,
            delivery: {
                enabled: form.deliveryEnabled,
                flatFee: flatFee as number,
                minOrder: minOrder as number,
                ...(freeAbove !== undefined ? { freeAbove: freeAbove as number } : {}),
            },
            pickup: { enabled: form.pickupEnabled },
            dineIn: { enabled: form.dineInEnabled },
            cashAccepted: form.cashAccepted,
        },
    };
}

const Toggle: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }> = ({ label, checked, onChange, hint }) => (
    <label className="flex items-start gap-2 text-sm text-[var(--rp-text)]">
        <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>
            {label}
            {hint && <span className="block text-xs text-[var(--rp-muted)]">{hint}</span>}
        </span>
    </label>
);

/** Ordering settings: site address, open/closed, order types, delivery fee, tax and cash. */
const OrderingSettings: React.FC = () => {
    const [view, setView] = useState<OrderingSettingsView | null>(null);
    const [form, setForm] = useState<SettingsForm | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        ordersAPI.getSettings()
            .then((v) => { setView(v); setForm(toForm(v)); })
            .catch((e: Error) => setError(e.message));
    }, []);

    if (!form || !view) {
        return error
            ? <p role="alert" className="text-sm font-medium text-[var(--rp-danger)]">{error}</p>
            : <p className="text-sm text-[var(--rp-muted)]">Loading settings…</p>;
    }

    const set = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => {
        setForm({ ...form, [key]: value });
        setSaved(false);
    };

    const save = async () => {
        const body = fromForm(form);
        if (typeof body === 'string') return setError(body);
        setSaving(true);
        try {
            const next = await ordersAPI.saveSettings(body);
            setView(next);
            setForm(toForm(next));
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
            <SectionHeader title="Ordering settings" subtitle="How customers order from your website." />
            {error && <p role="alert" className="text-sm font-medium text-[var(--rp-danger)]">{error}</p>}
            {saved && <p role="status" className="text-sm font-medium text-[var(--rp-success)]">Settings saved.</p>}

            <Card className="space-y-3">
                <label htmlFor="ordering-slug" className="block text-sm font-medium text-[var(--rp-text)]">Web address</label>
                <div className="flex items-center gap-1">
                    <span className="text-sm text-[var(--rp-muted)]" aria-hidden>/r/</span>
                    <input id="ordering-slug" className={inputClass} value={form.slug} onChange={(e) => set('slug', e.target.value)} aria-describedby="slug-hint" />
                </div>
                <p id="slug-hint" className="text-xs text-[var(--rp-muted)]">Lowercase letters, numbers and hyphens. Changing it breaks links you've already shared.</p>
                <Toggle label="Taking orders" hint="Turn off to show the site as closed for orders." checked={form.storeOpen} onChange={(v) => set('storeOpen', v)} />
            </Card>

            <Card className="space-y-3">
                <h3 className="text-sm font-bold text-[var(--rp-text)]">Order types</h3>
                <Toggle label="Pickup" checked={form.pickupEnabled} onChange={(v) => set('pickupEnabled', v)} />
                <Toggle label="Dine-in" checked={form.dineInEnabled} onChange={(v) => set('dineInEnabled', v)} />
                <Toggle label="Delivery" checked={form.deliveryEnabled} onChange={(v) => set('deliveryEnabled', v)} />
                {form.deliveryEnabled && (
                    <div className="grid gap-3 sm:grid-cols-3">
                        <label className="text-sm text-[var(--rp-text)]">Delivery fee (₹)
                            <input className={inputClass} inputMode="decimal" value={form.flatFee} onChange={(e) => set('flatFee', e.target.value)} />
                        </label>
                        <label className="text-sm text-[var(--rp-text)]">Minimum order (₹)
                            <input className={inputClass} inputMode="decimal" value={form.minOrder} onChange={(e) => set('minOrder', e.target.value)} />
                        </label>
                        <label className="text-sm text-[var(--rp-text)]">Free delivery above (₹)
                            <input className={inputClass} inputMode="decimal" value={form.freeAbove} placeholder="Off" onChange={(e) => set('freeAbove', e.target.value)} />
                        </label>
                    </div>
                )}
            </Card>

            <Card className="space-y-3">
                <h3 className="text-sm font-bold text-[var(--rp-text)]">Payment and tax</h3>
                <p className="text-sm text-[var(--rp-muted)]">
                    {view.onlinePaymentsAvailable ? 'Online payment through Razorpay is on.' : "Online payment isn't set up yet, so only cash orders can be taken."}
                </p>
                <Toggle label="Accept cash" hint="Cash on delivery, or at the counter for pickup and dine-in." checked={form.cashAccepted} onChange={(v) => set('cashAccepted', v)} />
                <label className="block text-sm text-[var(--rp-text)] sm:w-40">Tax (%)
                    <input className={inputClass} inputMode="decimal" value={form.taxRatePercent} onChange={(e) => set('taxRatePercent', e.target.value)} />
                </label>
            </Card>

            <Button onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button>
        </div>
    );
};

export default OrderingSettings;
