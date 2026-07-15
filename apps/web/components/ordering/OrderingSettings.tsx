import React, { useEffect, useState, useCallback } from 'react';
import { Store, Bike, ShoppingBag, UtensilsCrossed, Percent, ExternalLink } from 'lucide-react';
import { orderingAdminAPI, type OrderingSettingsData } from '../../api';

/**
 * Ordering settings — live feature toggles for the storefront.
 * Every switch here changes what customers see and can do on the public
 * storefront immediately (store open, delivery, pickup, dine-in) plus the
 * tax rate and delivery fee/minimum used in checkout totals.
 */

const Toggle: React.FC<{ on: boolean; disabled?: boolean; onChange: (next: boolean) => void; label: string }> = ({ on, disabled, onChange, label }) => (
    <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
            on ? 'bg-emerald-500' : 'bg-slate-300'
        }`}
    >
        <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                on ? 'translate-x-6' : 'translate-x-1'
            }`}
        />
    </button>
);

interface RowProps {
    icon: React.ComponentType<{ size?: number | string }>;
    title: string;
    subtitle: string;
    on: boolean;
    saving: boolean;
    onChange: (next: boolean) => void;
    children?: React.ReactNode;
}

const FeatureRow: React.FC<RowProps> = ({ icon: Icon, title, subtitle, on, saving, onChange, children }) => (
    <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${on ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                    <Icon size={20} />
                </div>
                <div className="min-w-0">
                    <p className="font-bold text-slate-800 text-sm">{title}</p>
                    <p className="text-xs text-slate-500 truncate">{subtitle}</p>
                </div>
            </div>
            <div className="flex items-center gap-2">
                <span className={`text-xs font-bold ${on ? 'text-emerald-600' : 'text-slate-400'}`}>{on ? 'LIVE' : 'OFF'}</span>
                <Toggle on={on} disabled={saving} onChange={onChange} label={`Toggle ${title}`} />
            </div>
        </div>
        {on && children}
    </div>
);

const OrderingSettings: React.FC = () => {
    const [settings, setSettings] = useState<OrderingSettingsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [savedFlash, setSavedFlash] = useState(false);

    // Local text state for numeric fields (committed on blur)
    const [taxRate, setTaxRate] = useState('');
    const [deliveryFee, setDeliveryFee] = useState('');
    const [minOrder, setMinOrder] = useState('');

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const data = await orderingAdminAPI.getSettings();
            setSettings(data);
            setTaxRate(String(data.ordering.taxRatePercent ?? 5));
            setDeliveryFee(String(data.ordering.delivery?.flatFee ?? 0));
            setMinOrder(String(data.ordering.delivery?.minOrder ?? 0));
            setError(null);
        } catch (err: any) {
            setError(err?.message || 'Failed to load settings');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const save = useCallback(async (patch: Parameters<typeof orderingAdminAPI.updateSettings>[0]) => {
        setSaving(true);
        setError(null);
        try {
            const data = await orderingAdminAPI.updateSettings(patch);
            setSettings(data);
            setSavedFlash(true);
            setTimeout(() => setSavedFlash(false), 1500);
        } catch (err: any) {
            setError(err?.message || 'Failed to save — try again');
        } finally {
            setSaving(false);
        }
    }, []);

    if (loading) {
        return <div className="py-16 text-center text-slate-400 text-sm animate-pulse">Loading settings…</div>;
    }
    if (!settings) {
        return <div className="py-16 text-center text-red-500 text-sm">{error ?? 'Could not load settings'}</div>;
    }

    const ordering = settings.ordering;
    const deliveryOn = ordering.delivery?.enabled !== false;
    const pickupOn = ordering.pickup?.enabled !== false;
    const dineInOn = ordering.dineIn?.enabled !== false;

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-base font-extrabold text-slate-800">Live features</h2>
                    <p className="text-xs text-slate-500">Changes apply to your storefront immediately.</p>
                </div>
                {savedFlash && <span className="text-xs font-bold text-emerald-600">Saved ✓</span>}
            </div>

            {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">{error}</div>
            )}

            <FeatureRow
                icon={Store}
                title="Store open"
                subtitle="Master switch — customers can browse but not order when off"
                on={settings.storeOpen}
                saving={saving}
                onChange={(next) => save({ storeOpen: next })}
            />

            <FeatureRow
                icon={Bike}
                title="Delivery"
                subtitle="Customers can place delivery orders"
                on={deliveryOn}
                saving={saving}
                onChange={(next) => save({ delivery: { enabled: next } })}
            >
                <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 gap-3">
                    <label className="block">
                        <span className="text-xs text-slate-500 font-medium">Delivery fee (₹)</span>
                        <input
                            type="number" min={0} value={deliveryFee}
                            onChange={(e) => setDeliveryFee(e.target.value)}
                            onBlur={() => {
                                const v = Math.max(0, Number(deliveryFee) || 0);
                                if (v !== (ordering.delivery?.flatFee ?? 0)) void save({ delivery: { flatFee: v } });
                            }}
                            className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"
                        />
                    </label>
                    <label className="block">
                        <span className="text-xs text-slate-500 font-medium">Min order (₹)</span>
                        <input
                            type="number" min={0} value={minOrder}
                            onChange={(e) => setMinOrder(e.target.value)}
                            onBlur={() => {
                                const v = Math.max(0, Number(minOrder) || 0);
                                if (v !== (ordering.delivery?.minOrder ?? 0)) void save({ delivery: { minOrder: v } });
                            }}
                            className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"
                        />
                    </label>
                </div>
            </FeatureRow>

            <FeatureRow
                icon={ShoppingBag}
                title="Pickup"
                subtitle="Customers can order for self-pickup"
                on={pickupOn}
                saving={saving}
                onChange={(next) => save({ pickup: { enabled: next } })}
            />

            <FeatureRow
                icon={UtensilsCrossed}
                title="Dine-in"
                subtitle="QR-code dine-in ordering at the table"
                on={dineInOn}
                saving={saving}
                onChange={(next) => save({ dineIn: { enabled: next } })}
            />

            <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center">
                        <Percent size={20} />
                    </div>
                    <div>
                        <p className="font-bold text-slate-800 text-sm">Tax rate</p>
                        <p className="text-xs text-slate-500">Applied to the order subtotal at checkout</p>
                    </div>
                </div>
                <label className="block max-w-[160px]">
                    <span className="text-xs text-slate-500 font-medium">GST %</span>
                    <input
                        type="number" min={0} max={100} step={0.5} value={taxRate}
                        onChange={(e) => setTaxRate(e.target.value)}
                        onBlur={() => {
                            const v = Math.min(100, Math.max(0, Number(taxRate) || 0));
                            if (v !== (ordering.taxRatePercent ?? 5)) void save({ taxRatePercent: v });
                        }}
                        className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    />
                </label>
            </div>

            {settings.slug && (
                <a
                    href={`${import.meta.env.VITE_STOREFRONT_URL || ''}/${settings.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-2 text-sm font-bold text-orange-600 bg-orange-50 border border-orange-200 rounded-2xl py-3 hover:bg-orange-100 transition-colors"
                >
                    <ExternalLink size={16} />
                    View your live storefront (/{settings.slug})
                </a>
            )}
        </div>
    );
};

export default OrderingSettings;
