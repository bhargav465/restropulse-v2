import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, RotateCcw } from 'lucide-react';
import type { SitePage, StorefrontContent, StorefrontHoursEntry } from '@restropulse/shared';
import { cmsAPI, type CmsContentState } from '../../api';
import { Badge, Button, Card, SectionHeader } from '../ui';

const inputClass = 'w-full rounded-xl border border-[var(--rp-line)] bg-[var(--rp-surface)] px-3 py-2 text-sm text-[var(--rp-text)]';
const labelClass = 'block text-xs font-semibold text-[var(--rp-muted)]';
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

const lines = (text: string) => text.split('\n').map((s) => s.trim()).filter(Boolean);

/** Drop empty strings and empty objects so optional fields are omitted, not sent blank. */
export function cleanContent(content: StorefrontContent): StorefrontContent {
    const prune = (value: unknown): unknown => {
        if (typeof value === 'string') return value.trim() === '' ? undefined : value;
        if (Array.isArray(value)) return value.map(prune).filter((v) => v !== undefined);
        if (value && typeof value === 'object') {
            const entries = Object.entries(value).map(([k, v]) => [k, prune(v)] as const).filter(([, v]) => v !== undefined);
            return entries.length ? Object.fromEntries(entries) : undefined;
        }
        return value;
    };
    const cleaned = (prune(content) ?? {}) as StorefrontContent;
    // An announcement without text is meaningless; heroImages is always present.
    if (cleaned.announcement && !cleaned.announcement.text) delete cleaned.announcement;
    return { ...cleaned, heroImages: cleaned.heroImages ?? [] };
}

/** Keep the hours rows the owner filled in (both times, or marked closed). */
export function hoursFromRows(rows: StorefrontHoursEntry[]): StorefrontHoursEntry[] | undefined {
    const kept = rows
        .filter((r) => r.closed || (r.open && r.close))
        .map((r) => (r.closed ? { day: r.day, open: r.open || '00:00', close: r.close || '00:00', closed: true } : { day: r.day, open: r.open, close: r.close }));
    return kept.length ? kept : undefined;
}

const rowsFor = (hours?: StorefrontHoursEntry[]): StorefrontHoursEntry[] =>
    DAYS.map((day) => hours?.find((h) => h.day === day) ?? { day, open: '', close: '' });

const SiteContentEditor: React.FC = () => {
    const [state, setState] = useState<CmsContentState | null>(null);
    const [draft, setDraft] = useState<StorefrontContent>({ heroImages: [] });
    const [heroText, setHeroText] = useState('');
    const [galleryText, setGalleryText] = useState('');
    const [hours, setHours] = useState<StorefrontHoursEntry[]>(rowsFor());
    const [busy, setBusy] = useState<'save' | 'publish' | number | null>(null);
    const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
    const [dirty, setDirty] = useState(false);

    const apply = (next: CmsContentState) => {
        setState(next);
        setDraft(next.draft);
        setHeroText(next.draft.heroImages.join('\n'));
        setGalleryText((next.draft.gallery ?? []).map((g) => (g.caption ? `${g.url} | ${g.caption}` : g.url)).join('\n'));
        setHours(rowsFor(next.draft.hours));
        setDirty(false);
    };

    const load = useCallback(async () => {
        try {
            apply(await cmsAPI.getContent());
        } catch (e) {
            setMessage({ tone: 'error', text: (e as Error).message });
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const edit = (patch: Partial<StorefrontContent>) => {
        setDraft((d) => ({ ...d, ...patch }));
        setDirty(true);
    };

    const assemble = (): StorefrontContent => cleanContent({
        ...draft,
        heroImages: lines(heroText),
        gallery: lines(galleryText).map((line) => {
            const [url, ...caption] = line.split('|');
            return { url: url.trim(), ...(caption.length ? { caption: caption.join('|').trim() } : {}) };
        }),
        hours: hoursFromRows(hours),
    });

    const save = async (): Promise<boolean> => {
        setBusy('save');
        try {
            await cmsAPI.saveDraft(assemble());
            await load();
            setMessage({ tone: 'ok', text: 'Draft saved. Publish when you want it live.' });
            return true;
        } catch (e) {
            setMessage({ tone: 'error', text: (e as Error).message });
            return false;
        } finally {
            setBusy(null);
        }
    };

    const publish = async () => {
        if (dirty && !(await save())) return;
        setBusy('publish');
        try {
            const result = await cmsAPI.publish();
            await load();
            setMessage({ tone: 'ok', text: `Published version ${result.publishedVersion}.` });
        } catch (e) {
            setMessage({ tone: 'error', text: (e as Error).message });
        } finally {
            setBusy(null);
        }
    };

    const rollback = async (version: number) => {
        if (!window.confirm(`Put version ${version} back live? Your current draft will be replaced.`)) return;
        setBusy(version);
        try {
            const result = await cmsAPI.rollback(version);
            await load();
            setMessage({ tone: 'ok', text: `Version ${version} is live again as version ${result.publishedVersion}.` });
        } catch (e) {
            setMessage({ tone: 'error', text: (e as Error).message });
        } finally {
            setBusy(null);
        }
    };

    const setPage = (index: number, patch: Partial<SitePage>) => {
        const pages = [...(draft.pages ?? [])];
        pages[index] = { ...pages[index], ...patch };
        edit({ pages });
    };

    if (!state) {
        return message
            ? <p role="alert" className="text-sm font-medium text-[var(--rp-danger)]">{message.text}</p>
            : <p className="text-sm text-[var(--rp-muted)]">Loading your website content…</p>;
    }

    const unpublished = dirty || JSON.stringify(state.draft) !== JSON.stringify(state.published);

    return (
        <div className="space-y-5">
            <SectionHeader
                title="Site content"
                subtitle={state.publishedVersion
                    ? <>Live: version {state.publishedVersion}{unpublished && <> · <Badge tone="warning">Unpublished changes</Badge></>}</>
                    : 'Nothing published yet.'}
                right={
                    <div className="flex gap-2">
                        <Button variant="secondary" onClick={() => void save()} disabled={busy !== null}>{busy === 'save' ? 'Saving…' : 'Save draft'}</Button>
                        <Button onClick={() => void publish()} disabled={busy !== null}>{busy === 'publish' ? 'Publishing…' : 'Publish'}</Button>
                    </div>
                }
            />
            {message && (
                <p role={message.tone === 'error' ? 'alert' : 'status'}
                    className={`text-sm font-medium ${message.tone === 'error' ? 'text-[var(--rp-danger)]' : 'text-[var(--rp-success)]'}`}>
                    {message.text}
                </p>
            )}

            <Card className="space-y-3">
                <h3 className="font-bold text-[var(--rp-text)]">Home page</h3>
                <label className={labelClass}>Tagline
                    <input className={inputClass} value={draft.tagline ?? ''} onChange={(e) => edit({ tagline: e.target.value })} />
                </label>
                <div className="flex items-end gap-3">
                    <label className={`${labelClass} flex-1`}>Announcement bar
                        <input className={inputClass} value={draft.announcement?.text ?? ''}
                            onChange={(e) => edit({ announcement: { text: e.target.value, enabled: draft.announcement?.enabled ?? true } })} />
                    </label>
                    <label className="flex items-center gap-2 pb-2 text-sm text-[var(--rp-text)]">
                        <input type="checkbox" checked={draft.announcement?.enabled ?? false}
                            onChange={(e) => edit({ announcement: { text: draft.announcement?.text ?? '', enabled: e.target.checked } })} /> Show
                    </label>
                </div>
                <label className={labelClass}>About us
                    <textarea className={inputClass} rows={4} value={draft.about ?? ''} onChange={(e) => edit({ about: e.target.value })} />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className={labelClass}>Hero photos (one https link per line)
                        <textarea className={inputClass} rows={3} value={heroText} onChange={(e) => { setHeroText(e.target.value); setDirty(true); }} />
                    </label>
                    <label className={labelClass}>Gallery ("link | caption" per line)
                        <textarea className={inputClass} rows={3} value={galleryText} onChange={(e) => { setGalleryText(e.target.value); setDirty(true); }} />
                    </label>
                </div>
                <label className={labelClass}>Hero video link (optional)
                    <input className={inputClass} value={draft.videoUrl ?? ''} onChange={(e) => edit({ videoUrl: e.target.value })} />
                </label>
            </Card>

            <Card className="space-y-2">
                <h3 className="font-bold text-[var(--rp-text)]">Opening hours</h3>
                {hours.map((row, i) => (
                    <div key={row.day} className="grid grid-cols-[6rem_1fr_1fr_auto] items-center gap-2 text-sm">
                        <span className="text-[var(--rp-text)]">{row.day}</span>
                        <input type="time" aria-label={`${row.day} opens`} className={inputClass} value={row.open} disabled={row.closed}
                            onChange={(e) => { const next = [...hours]; next[i] = { ...row, open: e.target.value }; setHours(next); setDirty(true); }} />
                        <input type="time" aria-label={`${row.day} closes`} className={inputClass} value={row.close} disabled={row.closed}
                            onChange={(e) => { const next = [...hours]; next[i] = { ...row, close: e.target.value }; setHours(next); setDirty(true); }} />
                        <label className="flex items-center gap-1 text-xs text-[var(--rp-muted)]">
                            <input type="checkbox" checked={row.closed ?? false}
                                onChange={(e) => { const next = [...hours]; next[i] = { ...row, closed: e.target.checked }; setHours(next); setDirty(true); }} /> Closed
                        </label>
                    </div>
                ))}
            </Card>

            <Card className="space-y-3">
                <h3 className="font-bold text-[var(--rp-text)]">Contact and social</h3>
                <div className="grid gap-3 sm:grid-cols-3">
                    {(['phone', 'email', 'address'] as const).map((key) => (
                        <label key={key} className={`${labelClass} capitalize`}>{key}
                            <input className={inputClass} value={draft.contact?.[key] ?? ''} onChange={(e) => edit({ contact: { ...draft.contact, [key]: e.target.value } })} />
                        </label>
                    ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                    {(['instagram', 'facebook', 'x', 'youtube'] as const).map((key) => (
                        <label key={key} className={`${labelClass} capitalize`}>{key === 'x' ? 'X' : key} link
                            <input className={inputClass} value={draft.socialLinks?.[key] ?? ''} onChange={(e) => edit({ socialLinks: { ...draft.socialLinks, [key]: e.target.value } })} />
                        </label>
                    ))}
                </div>
            </Card>

            <Card className="space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="font-bold text-[var(--rp-text)]">Extra pages</h3>
                    <button type="button" onClick={() => edit({ pages: [...(draft.pages ?? []), { slug: '', title: '', body: '', visible: true }] })}
                        className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--rp-primary)]"><Plus size={16} /> Add page</button>
                </div>
                {(draft.pages ?? []).map((page, i) => (
                    <div key={i} className="space-y-2 rounded-xl border border-[var(--rp-line)] p-3">
                        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
                            <label className={labelClass}>Title
                                <input className={inputClass} value={page.title} onChange={(e) => setPage(i, { title: e.target.value })} />
                            </label>
                            <label className={labelClass}>Web address (e.g. catering)
                                <input className={inputClass} value={page.slug} onChange={(e) => setPage(i, { slug: e.target.value.toLowerCase() })} />
                            </label>
                            <label className="flex items-center gap-1 pb-2 text-xs text-[var(--rp-muted)]">
                                <input type="checkbox" checked={page.visible} onChange={(e) => setPage(i, { visible: e.target.checked })} /> Visible
                            </label>
                            <button type="button" aria-label={`Remove page ${page.title || i + 1}`}
                                onClick={() => edit({ pages: (draft.pages ?? []).filter((_, j) => j !== i) })}
                                className="rounded-lg p-2 text-[var(--rp-muted)] hover:text-[var(--rp-danger)]"><Trash2 size={16} /></button>
                        </div>
                        <textarea aria-label={`Text of page ${page.title || i + 1}`} className={inputClass} rows={3} value={page.body}
                            onChange={(e) => setPage(i, { body: e.target.value })} />
                    </div>
                ))}
            </Card>

            <Card className="space-y-3">
                <h3 className="font-bold text-[var(--rp-text)]">Look and search</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className={labelClass}>Brand colour (hex, e.g. #6B4EFF)
                        <input className={inputClass} value={draft.theme?.primaryColor ?? ''} onChange={(e) => edit({ theme: { ...draft.theme, primaryColor: e.target.value } })} />
                    </label>
                    <label className={labelClass}>Logo link
                        <input className={inputClass} value={draft.theme?.logoUrl ?? ''} onChange={(e) => edit({ theme: { ...draft.theme, logoUrl: e.target.value } })} />
                    </label>
                    <label className={labelClass}>Search title
                        <input className={inputClass} value={draft.seo?.title ?? ''} onChange={(e) => edit({ seo: { ...draft.seo, title: e.target.value } })} />
                    </label>
                    <label className={labelClass}>Search description
                        <input className={inputClass} value={draft.seo?.description ?? ''} onChange={(e) => edit({ seo: { ...draft.seo, description: e.target.value } })} />
                    </label>
                </div>
            </Card>

            {state.versions.length > 0 && (
                <Card className="space-y-2">
                    <h3 className="font-bold text-[var(--rp-text)]">Published versions</h3>
                    <ul className="divide-y divide-[var(--rp-line)]">
                        {state.versions.map((v) => (
                            <li key={v.version} className="flex items-center justify-between py-2 text-sm">
                                <span className="text-[var(--rp-text)]">
                                    Version {v.version} · {new Date(v.publishedAt).toLocaleString()}
                                    {v.version === state.publishedVersion && <> <Badge tone="success">Live</Badge></>}
                                </span>
                                {v.version !== state.publishedVersion && (
                                    <button type="button" onClick={() => void rollback(v.version)} disabled={busy !== null}
                                        className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--rp-primary)]">
                                        <RotateCcw size={14} /> Restore
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                </Card>
            )}
        </div>
    );
};

export default SiteContentEditor;
