import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Save, Rocket, Undo2 } from 'lucide-react';
import { StorefrontContent, StorefrontHoursEntry, StoryTimelineEntry, ChefBio, DineInInfoBlock } from '@restropulse/shared';
import { orderingAdminAPI } from '../../api';
import { ActionNotice } from '../ActionNotice';
import ConfirmDialog from '../ConfirmDialog';
import { PanelLoading, PanelError } from './PanelStates';

const inputCls = 'w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/30';
const labelCls = 'block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5';
const removeBtnCls = 'w-9 h-9 shrink-0 rounded-xl bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-100';
const addBtnCls = 'text-xs font-bold text-orange-600 hover:text-orange-700 flex items-center gap-1';

const Section: React.FC<{ title: string; children: React.ReactNode; defaultOpen?: boolean }> = ({ title, children, defaultOpen }) => (
    <details className="bg-white rounded-2xl border border-slate-100 shadow-sm group" open={defaultOpen}>
        <summary className="cursor-pointer list-none p-4 flex items-center justify-between">
            <span className="font-bold text-sm text-slate-800">{title}</span>
            <span className="text-slate-400 text-xs group-open:rotate-180 transition-transform">▾</span>
        </summary>
        <div className="px-4 pb-4 space-y-3">{children}</div>
    </details>
);

/** Simple editor for a list of URL strings (hero images, gallery). */
const UrlListEditor: React.FC<{ label: string; urls: string[]; onChange: (urls: string[]) => void }> = ({ label, urls, onChange }) => (
    <div className="space-y-2">
        {urls.map((url, i) => (
            <div key={i} className="flex gap-2">
                <input className={inputCls} type="url" placeholder="https://…" aria-label={`${label} URL ${i + 1}`} value={url} onChange={(e) => onChange(urls.map((u, j) => (j === i ? e.target.value : u)))} />
                <button type="button" className={removeBtnCls} aria-label={`Remove ${label} URL ${i + 1}`} onClick={() => onChange(urls.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
        ))}
        <button type="button" className={addBtnCls} onClick={() => onChange([...urls, ''])}><Plus size={14} /> Add URL</button>
    </div>
);

const DEFAULT_HOURS_ENTRY: StorefrontHoursEntry = { day: 'Monday', open: '11:00', close: '23:00' };

const SiteContentEditor: React.FC = () => {
    const [draft, setDraft] = useState<StorefrontContent | null>(null);
    const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
    const [versions, setVersions] = useState<Array<{ version: number; publishedAt: string }>>([]);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
    const [busy, setBusy] = useState<'save' | 'publish' | 'rollback' | null>(null);
    const [dirty, setDirty] = useState(false);
    const [savedUnpublished, setSavedUnpublished] = useState(false);
    const [confirmRollback, setConfirmRollback] = useState(false);

    const load = useCallback(async () => {
        setDraft(null);
        setError(null);
        try {
            const res = await orderingAdminAPI.getContentDraft();
            setDraft(res.draft);
            setPublishedVersion(res.publishedVersion);
            setVersions(res.versions);
            setDirty(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load site content');
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const update = (patch: Partial<StorefrontContent>) => {
        setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
        setDirty(true);
    };

    const handleSave = async () => {
        if (!draft) return;
        setBusy('save');
        try {
            await orderingAdminAPI.saveContentDraft(draft);
            setDirty(false);
            setSavedUnpublished(true);
            setNotice({ message: 'Draft saved.', type: 'success' });
        } catch (err) {
            setNotice({ message: err instanceof Error ? err.message : 'Failed to save draft', type: 'error' });
        } finally {
            setBusy(null);
        }
    };

    const handlePublish = async () => {
        if (!draft) return;
        setBusy('publish');
        try {
            if (dirty) await orderingAdminAPI.saveContentDraft(draft); // publish what's on screen
            const version = await orderingAdminAPI.publishContent();
            setPublishedVersion(version);
            setVersions((prev) => [...prev, { version, publishedAt: new Date().toISOString() }]);
            setDirty(false);
            setSavedUnpublished(false);
            setNotice({ message: `Published version ${version}.`, type: 'success' });
        } catch (err) {
            setNotice({ message: err instanceof Error ? err.message : 'Failed to publish', type: 'error' });
        } finally {
            setBusy(null);
        }
    };

    const handleRollback = async () => {
        setConfirmRollback(false);
        setBusy('rollback');
        try {
            const result = await orderingAdminAPI.rollbackContent();
            setNotice({ message: `Rolled back to version ${result.restoredFromVersion} (published as v${result.publishedVersion}).`, type: 'success' });
            await load();
            setSavedUnpublished(false);
        } catch (err) {
            setNotice({ message: err instanceof Error ? err.message : 'Failed to roll back', type: 'error' });
        } finally {
            setBusy(null);
        }
    };

    if (error) return <PanelError message={error} onRetry={load} />;
    if (!draft) return <PanelLoading label="Loading site content…" />;

    const announcement = draft.announcement ?? { text: '', enabled: false };
    const contact = draft.contact ?? {};
    const socialLinks = draft.socialLinks ?? {};
    const theme = draft.theme ?? {};
    const reservations = draft.reservations ?? { daysAhead: 14, slotMinutes: 30, maxPartySize: 10, startTime: '12:00', endTime: '22:30' };

    // Draft-vs-published indicator
    const statusBadge = dirty
        ? { text: 'Unsaved changes', cls: 'bg-amber-100 text-amber-700' }
        : savedUnpublished
            ? { text: 'Draft saved — not published', cls: 'bg-blue-50 text-blue-700' }
            : { text: publishedVersion ? `In sync with v${publishedVersion}` : 'Never published', cls: publishedVersion ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500' };

    return (
        <div className="space-y-4">
            {/* Status + actions */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                <div className="flex items-center justify-between mb-3">
                    <div>
                        <p className="text-sm font-extrabold text-slate-800">Storefront content</p>
                        <p className="text-xs text-slate-400 font-medium">
                            {publishedVersion ? `Published: v${publishedVersion}` : 'Not published yet'}
                            {versions.length > 0 && ` · ${versions.length} version${versions.length === 1 ? '' : 's'} in history`}
                        </p>
                    </div>
                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide ${statusBadge.cls}`}>{statusBadge.text}</span>
                </div>
                <div className="flex gap-2">
                    <button onClick={handleSave} disabled={busy !== null} className="flex-1 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-1.5">
                        <Save size={14} /> {busy === 'save' ? 'Saving…' : 'Save Draft'}
                    </button>
                    <button onClick={handlePublish} disabled={busy !== null} className="flex-1 py-2.5 rounded-xl bg-orange-600 text-white text-xs font-bold hover:bg-orange-700 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-1.5">
                        <Rocket size={14} /> {busy === 'publish' ? 'Publishing…' : 'Publish'}
                    </button>
                    <button onClick={() => setConfirmRollback(true)} disabled={busy !== null || versions.length < 2} className="flex-1 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-500 text-xs font-bold hover:bg-slate-50 active:scale-[0.98] transition-all disabled:opacity-40 flex items-center justify-center gap-1.5">
                        <Undo2 size={14} /> {busy === 'rollback' ? 'Rolling back…' : 'Rollback'}
                    </button>
                </div>
            </div>

            {notice && <ActionNotice message={notice.message} type={notice.type} onDismiss={() => setNotice(null)} />}

            <Section title="Hero media" defaultOpen>
                <div>
                    <label htmlFor="hero-video-url" className={labelCls}>Hero video URL (optional)</label>
                    <input
                        id="hero-video-url"
                        className={inputCls}
                        type="url"
                        placeholder="https://… (muted autoplay banner; first hero image is the poster/fallback)"
                        value={draft.videoUrl ?? ''}
                        onChange={(e) => update({ videoUrl: e.target.value || undefined })}
                    />
                </div>
                <UrlListEditor label="Hero image" urls={draft.heroImages} onChange={(heroImages) => update({ heroImages })} />
            </Section>

            <Section title="Announcement">
                <div>
                    <label htmlFor="announcement-text" className={labelCls}>Banner text</label>
                    <input id="announcement-text" className={inputCls} value={announcement.text} onChange={(e) => update({ announcement: { ...announcement, text: e.target.value } })} placeholder="e.g. Closed for Diwali on Nov 12" />
                </div>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input type="checkbox" checked={announcement.enabled} onChange={(e) => update({ announcement: { ...announcement, enabled: e.target.checked } })} className="w-4 h-4 accent-orange-600" />
                    Show announcement banner
                </label>
            </Section>

            <Section title="About">
                <label htmlFor="about-text" className="sr-only">About text</label>
                <textarea id="about-text" className={inputCls} rows={4} value={draft.about ?? ''} onChange={(e) => update({ about: e.target.value })} placeholder="Tell customers about your restaurant…" />
            </Section>

            <Section title="Opening hours">
                {(draft.hours ?? []).map((entry, i) => (
                    <div key={i} className="flex gap-2 items-center">
                        <input className={inputCls} aria-label={`Hours ${i + 1} day`} placeholder="Day" value={entry.day} onChange={(e) => update({ hours: draft.hours!.map((h, j) => (j === i ? { ...h, day: e.target.value } : h)) })} />
                        <input className={`${inputCls} w-24 shrink-0`} aria-label={`Hours ${i + 1} open`} type="time" value={entry.open} onChange={(e) => update({ hours: draft.hours!.map((h, j) => (j === i ? { ...h, open: e.target.value } : h)) })} />
                        <input className={`${inputCls} w-24 shrink-0`} aria-label={`Hours ${i + 1} close`} type="time" value={entry.close} onChange={(e) => update({ hours: draft.hours!.map((h, j) => (j === i ? { ...h, close: e.target.value } : h)) })} />
                        <label className="flex items-center gap-1 text-xs text-slate-500 shrink-0">
                            <input type="checkbox" checked={entry.closed === true} onChange={(e) => update({ hours: draft.hours!.map((h, j) => (j === i ? { ...h, closed: e.target.checked } : h)) })} className="w-3.5 h-3.5 accent-orange-600" />
                            Closed
                        </label>
                        <button type="button" className={removeBtnCls} aria-label={`Remove hours row ${i + 1}`} onClick={() => update({ hours: draft.hours!.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
                    </div>
                ))}
                <button type="button" className={addBtnCls} onClick={() => update({ hours: [...(draft.hours ?? []), { ...DEFAULT_HOURS_ENTRY }] })}><Plus size={14} /> Add day</button>
            </Section>

            <Section title="Contact">
                <div><label htmlFor="contact-phone" className={labelCls}>Phone</label><input id="contact-phone" className={inputCls} value={contact.phone ?? ''} onChange={(e) => update({ contact: { ...contact, phone: e.target.value } })} /></div>
                <div><label htmlFor="contact-email" className={labelCls}>Email</label><input id="contact-email" className={inputCls} type="email" value={contact.email ?? ''} onChange={(e) => update({ contact: { ...contact, email: e.target.value } })} /></div>
                <div><label htmlFor="contact-address" className={labelCls}>Address</label><input id="contact-address" className={inputCls} value={contact.address ?? ''} onChange={(e) => update({ contact: { ...contact, address: e.target.value } })} /></div>
            </Section>

            <Section title="Social links">
                {(['instagram', 'facebook', 'x', 'youtube'] as const).map((key) => (
                    <div key={key}>
                        <label htmlFor={`social-${key}`} className={labelCls}>{key === 'x' ? 'X (Twitter)' : key}</label>
                        <input id={`social-${key}`} className={inputCls} type="url" placeholder="https://…" value={socialLinks[key] ?? ''} onChange={(e) => update({ socialLinks: { ...socialLinks, [key]: e.target.value } })} />
                    </div>
                ))}
            </Section>

            <Section title="Story timeline">
                {(draft.story ?? []).map((entry: StoryTimelineEntry, i) => (
                    <div key={i} className="border border-slate-100 rounded-xl p-3 space-y-2">
                        <div className="flex gap-2">
                            <input className={`${inputCls} w-24 shrink-0`} aria-label={`Story ${i + 1} year`} placeholder="Year" value={entry.year} onChange={(e) => update({ story: draft.story!.map((s, j) => (j === i ? { ...s, year: e.target.value } : s)) })} />
                            <input className={inputCls} aria-label={`Story ${i + 1} title`} placeholder="Title" value={entry.title} onChange={(e) => update({ story: draft.story!.map((s, j) => (j === i ? { ...s, title: e.target.value } : s)) })} />
                            <button type="button" className={removeBtnCls} aria-label={`Remove story entry ${i + 1}`} onClick={() => update({ story: draft.story!.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
                        </div>
                        <textarea className={inputCls} rows={2} aria-label={`Story ${i + 1} text`} placeholder="What happened…" value={entry.text} onChange={(e) => update({ story: draft.story!.map((s, j) => (j === i ? { ...s, text: e.target.value } : s)) })} />
                        <input className={inputCls} type="url" aria-label={`Story ${i + 1} image URL`} placeholder="Image URL (optional)" value={entry.image ?? ''} onChange={(e) => update({ story: draft.story!.map((s, j) => (j === i ? { ...s, image: e.target.value } : s)) })} />
                    </div>
                ))}
                <button type="button" className={addBtnCls} onClick={() => update({ story: [...(draft.story ?? []), { year: '', title: '', text: '' }] })}><Plus size={14} /> Add timeline entry</button>
            </Section>

            <Section title="Chef bios">
                {(draft.chefs ?? []).map((chef: ChefBio, i) => (
                    <div key={i} className="border border-slate-100 rounded-xl p-3 space-y-2">
                        <div className="flex gap-2">
                            <input className={inputCls} aria-label={`Chef ${i + 1} name`} placeholder="Name" value={chef.name} onChange={(e) => update({ chefs: draft.chefs!.map((c, j) => (j === i ? { ...c, name: e.target.value } : c)) })} />
                            <input className={inputCls} aria-label={`Chef ${i + 1} title`} placeholder="Title (e.g. Head Chef)" value={chef.title ?? ''} onChange={(e) => update({ chefs: draft.chefs!.map((c, j) => (j === i ? { ...c, title: e.target.value } : c)) })} />
                            <button type="button" className={removeBtnCls} aria-label={`Remove chef ${i + 1}`} onClick={() => update({ chefs: draft.chefs!.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
                        </div>
                        <textarea className={inputCls} rows={2} aria-label={`Chef ${i + 1} bio`} placeholder="Bio" value={chef.bio} onChange={(e) => update({ chefs: draft.chefs!.map((c, j) => (j === i ? { ...c, bio: e.target.value } : c)) })} />
                        <input className={inputCls} type="url" aria-label={`Chef ${i + 1} photo URL`} placeholder="Photo URL (optional)" value={chef.photo ?? ''} onChange={(e) => update({ chefs: draft.chefs!.map((c, j) => (j === i ? { ...c, photo: e.target.value } : c)) })} />
                    </div>
                ))}
                <button type="button" className={addBtnCls} onClick={() => update({ chefs: [...(draft.chefs ?? []), { name: '', bio: '' }] })}><Plus size={14} /> Add chef</button>
            </Section>

            <Section title="Gallery">
                <UrlListEditor label="Gallery image" urls={draft.gallery ?? []} onChange={(gallery) => update({ gallery })} />
            </Section>

            <Section title="Dine-in info">
                {(draft.dineIn ?? []).map((block: DineInInfoBlock, i) => (
                    <div key={i} className="border border-slate-100 rounded-xl p-3 space-y-2">
                        <div className="flex gap-2">
                            <input className={inputCls} aria-label={`Dine-in ${i + 1} title`} placeholder="Title" value={block.title} onChange={(e) => update({ dineIn: draft.dineIn!.map((d, j) => (j === i ? { ...d, title: e.target.value } : d)) })} />
                            <button type="button" className={removeBtnCls} aria-label={`Remove dine-in block ${i + 1}`} onClick={() => update({ dineIn: draft.dineIn!.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
                        </div>
                        <textarea className={inputCls} rows={2} aria-label={`Dine-in ${i + 1} text`} placeholder="Text" value={block.text} onChange={(e) => update({ dineIn: draft.dineIn!.map((d, j) => (j === i ? { ...d, text: e.target.value } : d)) })} />
                        <input className={inputCls} type="url" aria-label={`Dine-in ${i + 1} image URL`} placeholder="Image URL (optional)" value={block.image ?? ''} onChange={(e) => update({ dineIn: draft.dineIn!.map((d, j) => (j === i ? { ...d, image: e.target.value } : d)) })} />
                    </div>
                ))}
                <button type="button" className={addBtnCls} onClick={() => update({ dineIn: [...(draft.dineIn ?? []), { title: '', text: '' }] })}><Plus size={14} /> Add dine-in block</button>
            </Section>

            <Section title="Reservation slots">
                <div className="grid grid-cols-2 gap-3">
                    <div><label htmlFor="res-days-ahead" className={labelCls}>Days ahead</label><input id="res-days-ahead" className={inputCls} type="number" min="1" value={reservations.daysAhead} onChange={(e) => update({ reservations: { ...reservations, daysAhead: Number(e.target.value) || 1 } })} /></div>
                    <div><label htmlFor="res-slot-minutes" className={labelCls}>Slot minutes</label><input id="res-slot-minutes" className={inputCls} type="number" min="5" step="5" value={reservations.slotMinutes} onChange={(e) => update({ reservations: { ...reservations, slotMinutes: Number(e.target.value) || 30 } })} /></div>
                    <div><label htmlFor="res-max-party" className={labelCls}>Max party size</label><input id="res-max-party" className={inputCls} type="number" min="1" value={reservations.maxPartySize} onChange={(e) => update({ reservations: { ...reservations, maxPartySize: Number(e.target.value) || 1 } })} /></div>
                    <div></div>
                    <div><label htmlFor="res-start" className={labelCls}>Start time</label><input id="res-start" className={inputCls} type="time" value={reservations.startTime} onChange={(e) => update({ reservations: { ...reservations, startTime: e.target.value } })} /></div>
                    <div><label htmlFor="res-end" className={labelCls}>End time</label><input id="res-end" className={inputCls} type="time" value={reservations.endTime} onChange={(e) => update({ reservations: { ...reservations, endTime: e.target.value } })} /></div>
                </div>
            </Section>

            <Section title="Theme">
                <div className="grid grid-cols-3 gap-3">
                    {(['primaryColor', 'secondaryColor', 'accentColor'] as const).map((key) => (
                        <div key={key}>
                            <label htmlFor={`theme-${key}`} className={labelCls}>{key.replace('Color', '')}</label>
                            <input id={`theme-${key}`} className="w-full h-10 rounded-xl border border-slate-200 bg-white p-1" type="color" value={theme[key] ?? '#f97316'} onChange={(e) => update({ theme: { ...theme, [key]: e.target.value } })} />
                        </div>
                    ))}
                </div>
                <div>
                    <label htmlFor="theme-logo-url" className={labelCls}>Logo URL</label>
                    <input id="theme-logo-url" className={inputCls} type="url" placeholder="https://…" value={theme.logoUrl ?? ''} onChange={(e) => update({ theme: { ...theme, logoUrl: e.target.value } })} />
                </div>
            </Section>

            {confirmRollback && (
                <ConfirmDialog
                    title="Roll back published content?"
                    message="The previous published version will be restored as both draft and live content. Your current draft will be replaced."
                    confirmLabel="Roll back"
                    onConfirm={handleRollback}
                    onCancel={() => setConfirmRollback(false)}
                />
            )}
        </div>
    );
};

export default SiteContentEditor;
