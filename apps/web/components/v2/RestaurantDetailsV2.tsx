import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Restaurant, RestaurantProfilePatch, StorefrontContent } from '@restropulse/shared';
import { restaurantAPI, orderingAdminAPI } from '../../api';
import { SubNav } from './primitives';
import HoursEditor from '../ordering/HoursEditor';

/**
 * Restaurant Details (Brief 04 / DESIGN-04) — the v2 "business facts" page.
 *
 * Five quiet underline tabs (Basics · Address & Contact · Legal · Branding ·
 * Hours). Business facts save straight through `updateProfile` (PATCH). Anything
 * the public storefront renders — the "Use as storefront logo" action and the
 * Hours tab — routes through the storefront-content DRAFT (single source of
 * truth), surfaced to the owner as "Saved to draft — publish to go live".
 *
 * Tokens only (design.md §2/§3): semantic classes, no raw hex, no emoji in
 * labels. Muted (text-muted) label/hint text on the white surface.
 */

type ProfileTab = 'BASICS' | 'ADDRESS' | 'LEGAL' | 'BRANDING' | 'HOURS';

const TABS = [
    { id: 'BASICS' as const, label: 'Basics' },
    { id: 'ADDRESS' as const, label: 'Address & Contact' },
    { id: 'LEGAL' as const, label: 'Legal' },
    { id: 'BRANDING' as const, label: 'Branding' },
    { id: 'HOURS' as const, label: 'Hours' },
];

const PRICE_RANGES: Array<{ value: NonNullable<Restaurant['priceRange']>; label: string }> = [
    { value: 'budget', label: 'Budget' },
    { value: 'mid-range', label: 'Mid-range' },
    { value: 'upscale', label: 'Upscale' },
    { value: 'fine-dining', label: 'Fine dining' },
];

// Mirror the server-side validators so the UI shows the same 400 messages inline.
const PINCODE_RE = /^[1-9][0-9]{5}$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const FSSAI_RE = /^[0-9]{14}$/;
const EMAIL_RE = /^\S+@\S+\.\S+$/;

const labelCls = 'block text-[11px] font-semibold uppercase tracking-wider text-muted mb-1.5';
const inputCls = 'w-full bg-surface border border-line rounded-xl px-3 py-2.5 text-sm text-ink placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30';
const hintCls = 'mt-1 text-xs text-muted';
const errCls = 'mt-1 text-xs text-danger';
const cardCls = 'bg-surface rounded-2xl border border-line p-6 space-y-5';
const primaryBtn = 'px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary-strong active:scale-[0.99] transition-all disabled:opacity-50';
const secondaryBtn = 'px-4 py-2.5 rounded-xl bg-primary-soft text-primary-strong text-sm font-semibold hover:bg-primary hover:text-white active:scale-[0.99] transition-all disabled:opacity-50';

interface FormState {
    name: string;
    legalName: string;
    cuisineTags: string[];
    description: string;
    priceRange: '' | NonNullable<Restaurant['priceRange']>;
    line1: string;
    line2: string;
    city: string;
    state: string;
    pincode: string;
    phone: string;
    email: string;
    website: string;
    gstin: string;
    fssaiLicense: string;
    logoUrl: string;
    coverImageUrl: string;
}

function toForm(r: Restaurant): FormState {
    return {
        name: r.name ?? '',
        legalName: r.legalName ?? '',
        cuisineTags: r.cuisineTags ? [...r.cuisineTags] : [],
        description: r.description ?? '',
        priceRange: r.priceRange ?? '',
        line1: r.address?.line1 ?? '',
        line2: r.address?.line2 ?? '',
        city: r.address?.city ?? '',
        state: r.address?.state ?? '',
        pincode: r.address?.pincode ?? '',
        phone: r.phone ?? '',
        email: r.email ?? '',
        website: r.website ?? '',
        gstin: r.gstin ?? '',
        fssaiLicense: r.fssaiLicense ?? '',
        logoUrl: r.logoUrl ?? '',
        coverImageUrl: r.coverImageUrl ?? '',
    };
}

/** Optional text field: '' means "clear it" → null (server $unset). */
function optional(value: string): string | null {
    return value.trim() === '' ? null : value.trim();
}

const Notice: React.FC<{ notice: { message: string; type: 'success' | 'error' } | null }> = ({ notice }) => {
    if (!notice) return null;
    const tone = notice.type === 'success' ? 'bg-success/10 text-success border-success/30' : 'bg-danger/10 text-danger border-danger/30';
    return <div role="status" className={`rounded-xl border px-4 py-2.5 text-sm font-medium ${tone}`}>{notice.message}</div>;
};

interface RestaurantDetailsV2Props {
    restaurantData: Restaurant;
    onRefreshRestaurant?: () => void | Promise<void>;
}

const RestaurantDetailsV2: React.FC<RestaurantDetailsV2Props> = ({ restaurantData, onRefreshRestaurant }) => {
    const [tab, setTab] = useState<ProfileTab>('BASICS');
    const original = useRef<Restaurant>(restaurantData);
    const [form, setForm] = useState<FormState>(() => toForm(restaurantData));
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [tagInput, setTagInput] = useState('');
    const [logoPreview, setLogoPreview] = useState<string | null>(null);
    const [coverPreview, setCoverPreview] = useState<string | null>(null);

    // Storefront content draft (Hours tab + "Use as storefront logo").
    const [draft, setDraft] = useState<StorefrontContent | null>(null);
    const [draftDirty, setDraftDirty] = useState(false);
    const [draftBusy, setDraftBusy] = useState<'save' | 'publish' | null>(null);

    const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
        setForm((prev) => ({ ...prev, [key]: value }));
    };

    const loadDraft = useCallback(async () => {
        try {
            const res = await orderingAdminAPI.getContentDraft();
            setDraft(res.draft);
            setDraftDirty(false);
        } catch { /* new restaurants have no content yet */ }
    }, []);

    useEffect(() => { loadDraft(); }, [loadDraft]);

    // ----- Profile saves (business facts → PATCH) -----
    const persist = async (patch: RestaurantProfilePatch, fieldErrors: Record<string, string>) => {
        if (Object.keys(fieldErrors).length > 0) {
            setErrors(fieldErrors);
            setNotice({ message: 'Please fix the highlighted fields.', type: 'error' });
            return;
        }
        setErrors({});
        if (Object.keys(patch).length === 0) {
            setNotice({ message: 'Nothing to save yet.', type: 'success' });
            return;
        }
        setSaving(true);
        try {
            const updated = await restaurantAPI.updateProfile(patch);
            original.current = updated;
            setForm(toForm(updated));
            setNotice({ message: 'Saved.', type: 'success' });
            await onRefreshRestaurant?.();
        } catch (err) {
            setNotice({ message: err instanceof Error ? err.message : 'Failed to save', type: 'error' });
        } finally {
            setSaving(false);
        }
    };

    const saveBasics = () => {
        const o = original.current;
        const patch: RestaurantProfilePatch = {};
        if (form.name.trim() !== (o.name ?? '')) patch.name = form.name.trim();
        if (form.legalName !== (o.legalName ?? '')) patch.legalName = optional(form.legalName) as string;
        if (JSON.stringify(form.cuisineTags) !== JSON.stringify(o.cuisineTags ?? [])) patch.cuisineTags = form.cuisineTags;
        if (form.description !== (o.description ?? '')) patch.description = optional(form.description) as string;
        if (form.priceRange !== (o.priceRange ?? '')) patch.priceRange = (form.priceRange || undefined) as Restaurant['priceRange'];
        const fieldErrors: Record<string, string> = {};
        if (form.name.trim().length === 0) fieldErrors.name = 'Name is required.';
        persist(patch, fieldErrors);
    };

    const saveAddress = () => {
        const o = original.current;
        const patch: RestaurantProfilePatch = {};
        const fieldErrors: Record<string, string> = {};

        const addrChanged =
            form.line1 !== (o.address?.line1 ?? '') || form.line2 !== (o.address?.line2 ?? '') ||
            form.city !== (o.address?.city ?? '') || form.state !== (o.address?.state ?? '') ||
            form.pincode !== (o.address?.pincode ?? '');

        // Address is all-or-nothing: only validate/send when the owner has begun filling it in.
        const anyAddr = [form.line1, form.city, form.state, form.pincode].some((v) => v.trim() !== '');
        if (addrChanged && anyAddr) {
            if (form.line1.trim() === '') fieldErrors.line1 = 'Address line 1 is required.';
            if (form.city.trim() === '') fieldErrors.city = 'City is required.';
            if (form.state.trim() === '') fieldErrors.state = 'State is required.';
            if (!PINCODE_RE.test(form.pincode)) fieldErrors.pincode = 'Enter a valid 6-digit PIN code.';
            if (Object.keys(fieldErrors).length === 0) {
                patch.address = {
                    line1: form.line1.trim(),
                    ...(form.line2.trim() ? { line2: form.line2.trim() } : {}),
                    city: form.city.trim(),
                    state: form.state.trim(),
                    pincode: form.pincode.trim(),
                    ...(o.address?.geo ? { geo: o.address.geo } : {}),
                };
                // Keep the legacy `location` string coherent for v1 surfaces/maps.
                patch.location = {
                    ...(o.location ?? { address: '', lat: 0, lng: 0, mapUrl: '' }),
                    address: `${form.line1.trim()}, ${form.city.trim()}, ${form.state.trim()} ${form.pincode.trim()}`,
                };
            }
        }

        if (form.phone !== (o.phone ?? '')) patch.phone = optional(form.phone) as string;
        if (form.website !== (o.website ?? '')) patch.website = optional(form.website) as string;
        if (form.email !== (o.email ?? '')) {
            if (form.email.trim() !== '' && !EMAIL_RE.test(form.email.trim())) fieldErrors.email = 'Enter a valid email address.';
            else patch.email = optional(form.email) as string;
        }

        persist(patch, fieldErrors);
    };

    const saveLegal = () => {
        const o = original.current;
        const patch: RestaurantProfilePatch = {};
        const fieldErrors: Record<string, string> = {};
        if (form.gstin !== (o.gstin ?? '')) {
            if (form.gstin.trim() !== '' && !GSTIN_RE.test(form.gstin.trim())) fieldErrors.gstin = 'Enter a valid 15-character GSTIN.';
            else patch.gstin = optional(form.gstin) as string;
        }
        if (form.fssaiLicense !== (o.fssaiLicense ?? '')) {
            if (form.fssaiLicense.trim() !== '' && !FSSAI_RE.test(form.fssaiLicense.trim())) fieldErrors.fssaiLicense = 'FSSAI licence must be 14 digits.';
            else patch.fssaiLicense = optional(form.fssaiLicense) as string;
        }
        persist(patch, fieldErrors);
    };

    // ----- Cuisine tag chip input -----
    const addTag = () => {
        const tag = tagInput.trim();
        if (!tag) return;
        if (form.cuisineTags.length >= 10) { setNotice({ message: 'Up to 10 cuisine tags.', type: 'error' }); return; }
        if (tag.length > 30) { setNotice({ message: 'Each tag is at most 30 characters.', type: 'error' }); return; }
        if (!form.cuisineTags.includes(tag)) set('cuisineTags', [...form.cuisineTags, tag]);
        setTagInput('');
    };

    // ----- Branding: upload + preview -----
    const handleFile = async (file: File | undefined, kind: 'logo' | 'cover') => {
        if (!file) return;
        const localUrl = URL.createObjectURL(file);
        if (kind === 'logo') setLogoPreview(localUrl); else setCoverPreview(localUrl);
        setSaving(true);
        try {
            const { url } = await restaurantAPI.uploadAsset(file, kind);
            const field = kind === 'logo' ? 'logoUrl' : 'coverImageUrl';
            const updated = await restaurantAPI.updateProfile({ [field]: url } as RestaurantProfilePatch);
            original.current = updated;
            setForm(toForm(updated));
            setNotice({ message: kind === 'logo' ? 'Logo updated.' : 'Cover updated.', type: 'success' });
            await onRefreshRestaurant?.();
        } catch (err) {
            setNotice({ message: err instanceof Error ? err.message : 'Upload failed', type: 'error' });
        } finally {
            setSaving(false);
        }
    };

    const useAsStorefrontLogo = async () => {
        if (!form.logoUrl) { setNotice({ message: 'Upload a logo first.', type: 'error' }); return; }
        setDraftBusy('save');
        try {
            const current = draft ?? (await orderingAdminAPI.getContentDraft()).draft;
            const next: StorefrontContent = { ...current, theme: { ...(current.theme ?? {}), logoUrl: form.logoUrl } };
            await orderingAdminAPI.saveContentDraft(next);
            setDraft(next);
            setDraftDirty(true);
            setNotice({ message: 'Saved to draft — publish to go live', type: 'success' });
        } catch (err) {
            setNotice({ message: err instanceof Error ? err.message : 'Failed to save draft', type: 'error' });
        } finally {
            setDraftBusy(null);
        }
    };

    // ----- Hours (storefront draft) -----
    const saveHoursDraft = async () => {
        if (!draft) return;
        setDraftBusy('save');
        try {
            await orderingAdminAPI.saveContentDraft(draft);
            setDraftDirty(true);
            setNotice({ message: 'Saved to draft — publish to go live', type: 'success' });
        } catch (err) {
            setNotice({ message: err instanceof Error ? err.message : 'Failed to save draft', type: 'error' });
        } finally {
            setDraftBusy(null);
        }
    };

    const publishDraft = async () => {
        setDraftBusy('publish');
        try {
            if (draft) await orderingAdminAPI.saveContentDraft(draft);
            const version = await orderingAdminAPI.publishContent();
            setDraftDirty(false);
            setNotice({ message: `Published version ${version}.`, type: 'success' });
        } catch (err) {
            setNotice({ message: err instanceof Error ? err.message : 'Failed to publish', type: 'error' });
        } finally {
            setDraftBusy(null);
        }
    };

    const ordering = restaurantData.ordering;
    const orderingStrip = useMemo(() => ([
        { label: 'Tax', value: ordering?.taxRatePercent != null ? `${ordering.taxRatePercent}%` : '—' },
        { label: 'Delivery fee', value: ordering?.delivery?.flatFee != null ? `₹${ordering.delivery.flatFee}` : '—' },
        { label: 'Min order', value: ordering?.delivery?.minOrder != null ? `₹${ordering.delivery.minOrder}` : '—' },
    ]), [ordering]);

    return (
        <div className="space-y-6">
            <SubNav tabs={TABS} active={tab} onChange={setTab} label="Restaurant details sections" />
            <Notice notice={notice} />

            {tab === 'BASICS' && (
                <div className={cardCls}>
                    <div>
                        <label htmlFor="rd-name" className={labelCls}>Restaurant name</label>
                        <input id="rd-name" className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Your restaurant's public name" />
                        {errors.name && <p className={errCls}>{errors.name}</p>}
                    </div>
                    <div>
                        <label htmlFor="rd-legal" className={labelCls}>Legal / registered name</label>
                        <input id="rd-legal" className={inputCls} value={form.legalName} onChange={(e) => set('legalName', e.target.value)} placeholder="As registered (optional)" />
                    </div>
                    <div>
                        <label htmlFor="rd-tag-input" className={labelCls}>Cuisine tags</label>
                        <div className="flex flex-wrap gap-2 mb-2">
                            {form.cuisineTags.map((tag) => (
                                <span key={tag} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary-soft text-primary-strong text-sm font-medium">
                                    {tag}
                                    <button type="button" aria-label={`Remove ${tag}`} className="text-primary-strong/70 hover:text-primary-strong" onClick={() => set('cuisineTags', form.cuisineTags.filter((t) => t !== tag))}>×</button>
                                </span>
                            ))}
                        </div>
                        <input
                            id="rd-tag-input"
                            className={inputCls}
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                            placeholder="Type a cuisine and press Enter (e.g. Biryani)"
                        />
                        <p className={hintCls}>Up to 10 tags. The legacy cuisine text stays for AI prompts.</p>
                    </div>
                    <div>
                        <label htmlFor="rd-desc" className={labelCls}>Description</label>
                        <textarea id="rd-desc" rows={3} className={inputCls} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="A short bio used in posts and your storefront." />
                    </div>
                    <div>
                        <label htmlFor="rd-price" className={labelCls}>Price range</label>
                        <select id="rd-price" className={inputCls} value={form.priceRange} onChange={(e) => set('priceRange', e.target.value as FormState['priceRange'])}>
                            <option value="">Not set</option>
                            {PRICE_RANGES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                        </select>
                    </div>

                    <div className="rounded-xl border border-line bg-canvas p-4">
                        <p className={labelCls}>Ordering settings</p>
                        <div className="grid grid-cols-3 gap-4">
                            {orderingStrip.map((s) => (
                                <div key={s.label}>
                                    <p className="text-lg font-semibold text-ink tabular-nums">{s.value}</p>
                                    <p className="text-xs text-muted">{s.label}</p>
                                </div>
                            ))}
                        </div>
                        <p className={hintCls}>Edited in Online Ordering.</p>
                    </div>

                    <div className="flex justify-end">
                        <button type="button" className={primaryBtn} disabled={saving} onClick={saveBasics}>{saving ? 'Saving…' : 'Save basics'}</button>
                    </div>
                </div>
            )}

            {tab === 'ADDRESS' && (
                <div className={cardCls}>
                    <div>
                        <label htmlFor="rd-line1" className={labelCls}>Address line 1</label>
                        <input id="rd-line1" className={inputCls} value={form.line1} onChange={(e) => set('line1', e.target.value)} placeholder="Building, street" />
                        {errors.line1 && <p className={errCls}>{errors.line1}</p>}
                    </div>
                    <div>
                        <label htmlFor="rd-line2" className={labelCls}>Address line 2</label>
                        <input id="rd-line2" className={inputCls} value={form.line2} onChange={(e) => set('line2', e.target.value)} placeholder="Area, landmark (optional)" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                            <label htmlFor="rd-city" className={labelCls}>City</label>
                            <input id="rd-city" className={inputCls} value={form.city} onChange={(e) => set('city', e.target.value)} />
                            {errors.city && <p className={errCls}>{errors.city}</p>}
                        </div>
                        <div>
                            <label htmlFor="rd-state" className={labelCls}>State</label>
                            <input id="rd-state" className={inputCls} value={form.state} onChange={(e) => set('state', e.target.value)} />
                            {errors.state && <p className={errCls}>{errors.state}</p>}
                        </div>
                        <div>
                            <label htmlFor="rd-pincode" className={labelCls}>PIN code</label>
                            <input id="rd-pincode" className={inputCls} value={form.pincode} onChange={(e) => set('pincode', e.target.value)} inputMode="numeric" placeholder="560038" />
                            {errors.pincode && <p className={errCls}>{errors.pincode}</p>}
                        </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                            <label htmlFor="rd-phone" className={labelCls}>Phone</label>
                            <input id="rd-phone" className={inputCls} value={form.phone} onChange={(e) => set('phone', e.target.value)} />
                        </div>
                        <div>
                            <label htmlFor="rd-email" className={labelCls}>Email</label>
                            <input id="rd-email" className={inputCls} value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="hello@restaurant.com" />
                            {errors.email && <p className={errCls}>{errors.email}</p>}
                        </div>
                        <div>
                            <label htmlFor="rd-website" className={labelCls}>Website</label>
                            <input id="rd-website" className={inputCls} value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" />
                        </div>
                    </div>
                    <div className="flex justify-end">
                        <button type="button" className={primaryBtn} disabled={saving} onClick={saveAddress}>{saving ? 'Saving…' : 'Save address & contact'}</button>
                    </div>
                </div>
            )}

            {tab === 'LEGAL' && (
                <div className={cardCls}>
                    <div>
                        <label htmlFor="rd-gstin" className={labelCls}>GSTIN</label>
                        <input id="rd-gstin" className={inputCls} value={form.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} placeholder="29ABCDE1234F1Z5" />
                        <p className={hintCls}>15 characters — 2-digit state code, PAN, entity code, Z, checksum.</p>
                        {errors.gstin && <p className={errCls}>{errors.gstin}</p>}
                    </div>
                    <div>
                        <label htmlFor="rd-fssai" className={labelCls}>FSSAI licence number</label>
                        <input id="rd-fssai" className={inputCls} value={form.fssaiLicense} onChange={(e) => set('fssaiLicense', e.target.value)} inputMode="numeric" placeholder="12345678901234" />
                        <p className={hintCls}>14-digit licence number printed on your FSSAI certificate.</p>
                        {errors.fssaiLicense && <p className={errCls}>{errors.fssaiLicense}</p>}
                    </div>
                    <div className="flex justify-end">
                        <button type="button" className={primaryBtn} disabled={saving} onClick={saveLegal}>{saving ? 'Saving…' : 'Save legal details'}</button>
                    </div>
                </div>
            )}

            {tab === 'BRANDING' && (
                <div className={cardCls}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div>
                            <p className={labelCls}>Logo</p>
                            <div className="w-28 h-28 rounded-2xl border border-line bg-canvas overflow-hidden flex items-center justify-center">
                                {(logoPreview || form.logoUrl)
                                    ? <img src={logoPreview || form.logoUrl} alt="Logo preview" className="w-full h-full object-cover" />
                                    : <span className="text-xs text-muted">No logo</span>}
                            </div>
                            <label className="mt-3 inline-block">
                                <span className={secondaryBtn}>Choose logo</span>
                                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Upload logo" onChange={(e) => handleFile(e.target.files?.[0], 'logo')} />
                            </label>
                        </div>
                        <div>
                            <p className={labelCls}>Cover image</p>
                            <div className="w-full aspect-video rounded-2xl border border-line bg-canvas overflow-hidden flex items-center justify-center">
                                {(coverPreview || form.coverImageUrl)
                                    ? <img src={coverPreview || form.coverImageUrl} alt="Cover preview" className="w-full h-full object-cover" />
                                    : <span className="text-xs text-muted">No cover</span>}
                            </div>
                            <label className="mt-3 inline-block">
                                <span className={secondaryBtn}>Choose cover</span>
                                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Upload cover" onChange={(e) => handleFile(e.target.files?.[0], 'cover')} />
                            </label>
                        </div>
                    </div>
                    <p className={hintCls}>PNG, JPEG or WebP, up to 5 MB. Saved to your profile immediately.</p>
                    <div className="border-t border-line pt-4 flex flex-wrap items-center gap-3">
                        <button type="button" className={secondaryBtn} disabled={draftBusy !== null} onClick={useAsStorefrontLogo}>Use as storefront logo</button>
                        <button type="button" className={primaryBtn} disabled={draftBusy !== null || !draftDirty} onClick={publishDraft}>{draftBusy === 'publish' ? 'Publishing…' : 'Publish'}</button>
                        <p className={hintCls}>The storefront logo lives in your published site — draft first, then publish.</p>
                    </div>
                </div>
            )}

            {tab === 'HOURS' && (
                <div className={cardCls}>
                    <p className={hintCls}>Opening hours are part of your storefront — saved to draft, then published to go live.</p>
                    {draft ? (
                        <div className="space-y-3">
                            <HoursEditor value={draft.hours ?? []} onChange={(hours) => { setDraft({ ...draft, hours }); setDraftDirty(true); }} />
                        </div>
                    ) : (
                        <p className="text-sm text-muted">Loading hours…</p>
                    )}
                    <div className="border-t border-line pt-4 flex flex-wrap items-center gap-3">
                        <button type="button" className={secondaryBtn} disabled={draftBusy !== null || !draft} onClick={saveHoursDraft}>{draftBusy === 'save' ? 'Saving…' : 'Save draft'}</button>
                        <button type="button" className={primaryBtn} disabled={draftBusy !== null || !draftDirty} onClick={publishDraft}>{draftBusy === 'publish' ? 'Publishing…' : 'Publish'}</button>
                        {draftDirty && <p className={hintCls}>Saved to draft — publish to go live.</p>}
                    </div>
                </div>
            )}
        </div>
    );
};

export default RestaurantDetailsV2;
