import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Upload, Leaf } from 'lucide-react';
import type { MenuCategory, MenuItemAvailability, OrderingMenuItem } from '@restropulse/shared';
import { cmsAPI, type CmsImportResult, type CmsItemInput } from '../../api';
import { Badge, Button, Card, SectionHeader } from '../ui';

const AVAILABILITY_LABELS: Record<MenuItemAvailability, string> = {
    in_stock: 'In stock',
    out_of_stock: 'Sold out',
    hidden: 'Hidden',
};

const inputClass = 'w-full rounded-xl border border-[var(--rp-line)] bg-[var(--rp-surface)] px-3 py-2 text-sm text-[var(--rp-text)]';

interface ItemDraft {
    id?: string;
    categoryId: string;
    name: string;
    price: string;
    description: string;
    isVeg: boolean;
    isBestSeller: boolean;
    images: string;
    variants: string;
    addons: string;
}

const optionsToText = (options?: Array<{ name: string; price: number }>) =>
    (options ?? []).map((o) => `${o.name}: ${o.price}`).join('\n');

/** "Half: 260" per line → [{ name: 'Half', price: 260 }]. Returns an error message for a bad line. */
export function parseOptionLines(text: string): Array<{ name: string; price: number }> | string {
    const out: Array<{ name: string; price: number }> = [];
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        const match = /^(.+?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(line);
        if (!match) return `Write each option as "Name: price", like "Half: 260".`;
        out.push({ name: match[1].trim(), price: Number(match[2]) });
    }
    return out;
}

/** File.text() where available, FileReader otherwise (older browsers and jsdom). */
function readFileText(file: File): Promise<string> {
    if (typeof file.text === 'function') return file.text();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}

const emptyDraft = (categoryId: string): ItemDraft => ({
    categoryId, name: '', price: '', description: '', isVeg: false, isBestSeller: false, images: '', variants: '', addons: '',
});

const toDraft = (item: OrderingMenuItem): ItemDraft => ({
    id: item.id,
    categoryId: item.categoryId,
    name: item.name,
    price: String(item.price),
    description: item.description ?? '',
    isVeg: item.isVeg,
    isBestSeller: item.isBestSeller === true,
    images: (item.images ?? []).join('\n'),
    variants: optionsToText(item.variants),
    addons: optionsToText(item.addons),
});

const MenuEditor: React.FC = () => {
    const [categories, setCategories] = useState<MenuCategory[]>([]);
    const [items, setItems] = useState<OrderingMenuItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [newCategory, setNewCategory] = useState('');
    const [draft, setDraft] = useState<ItemDraft | null>(null);
    const [saving, setSaving] = useState(false);
    const [importResult, setImportResult] = useState<CmsImportResult | null>(null);

    const load = useCallback(async () => {
        try {
            const [cats, its] = await Promise.all([cmsAPI.getCategories(), cmsAPI.getItems()]);
            setCategories(cats);
            setItems(its);
            setError(null);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const itemsByCategory = useMemo(() => {
        const map = new Map<string, OrderingMenuItem[]>();
        for (const item of items) {
            const list = map.get(item.categoryId) ?? [];
            list.push(item);
            map.set(item.categoryId, list);
        }
        for (const list of map.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
        return map;
    }, [items]);

    const run = async (action: () => Promise<unknown>) => {
        try {
            setError(null);
            await action();
            await load();
        } catch (e) {
            setError((e as Error).message);
        }
    };

    const addCategory = () => {
        const name = newCategory.trim();
        if (!name) return;
        void run(async () => {
            await cmsAPI.createCategory({ name });
            setNewCategory('');
        });
    };

    const renameCategory = (category: MenuCategory) => {
        const name = window.prompt('Category name', category.name)?.trim();
        if (name && name !== category.name) void run(() => cmsAPI.updateCategory(category.id, { name }));
    };

    const deleteCategory = (category: MenuCategory) => {
        if (window.confirm(`Delete the "${category.name}" category?`)) void run(() => cmsAPI.deleteCategory(category.id));
    };

    const saveItem = async () => {
        if (!draft) return;
        const price = Number(draft.price);
        if (!draft.name.trim()) return setError('Give the item a name.');
        if (!draft.categoryId) return setError('Pick a category.');
        if (draft.price.trim() === '' || !Number.isFinite(price) || price < 0) return setError('Enter a price of 0 or more.');
        const variants = parseOptionLines(draft.variants);
        if (typeof variants === 'string') return setError(variants);
        const addons = parseOptionLines(draft.addons);
        if (typeof addons === 'string') return setError(addons);

        const input: CmsItemInput = {
            categoryId: draft.categoryId,
            name: draft.name.trim(),
            price,
            description: draft.description.trim() || undefined,
            isVeg: draft.isVeg,
            isBestSeller: draft.isBestSeller,
            images: draft.images.split('\n').map((s) => s.trim()).filter(Boolean),
            variants,
            addons,
        };
        setSaving(true);
        await run(async () => {
            if (draft.id) await cmsAPI.updateItem(draft.id, input);
            else await cmsAPI.createItem(input);
            setDraft(null);
        });
        setSaving(false);
    };

    const onCsv = async (file: File | undefined) => {
        if (!file) return;
        let text: string;
        try {
            text = await readFileText(file);
        } catch {
            setError("Couldn't read that file. Try saving it as CSV again.");
            return;
        }
        await run(async () => setImportResult(await cmsAPI.importCsv(text)));
    };

    if (loading) return <p className="text-sm text-[var(--rp-muted)]">Loading your menu…</p>;

    return (
        <div className="space-y-5">
            <SectionHeader
                title="Menu"
                subtitle="What you change here shows on your website and feeds your posts."
                right={
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--rp-line)] px-3 py-2 text-sm font-semibold text-[var(--rp-text)]">
                        <Upload size={16} /> Import CSV
                        <input type="file" accept=".csv,text/csv" className="sr-only" aria-label="Import menu CSV"
                            onChange={(e) => void onCsv(e.target.files?.[0])} />
                    </label>
                }
            />

            {error && <p role="alert" className="text-sm font-medium text-[var(--rp-danger)]">{error}</p>}
            {importResult && (
                <p role="status" className="text-sm text-[var(--rp-text)]">
                    Imported {importResult.created} new and updated {importResult.updated}.
                    {importResult.failed > 0 && ` ${importResult.failed} row(s) skipped: ${importResult.errors.slice(0, 3).map((e) => `row ${e.row} (${e.message})`).join(', ')}.`}
                </p>
            )}

            {categories.map((category) => (
                <Card key={category.id} className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <h3 className="font-bold text-[var(--rp-text)]">{category.name}</h3>
                        <div className="flex items-center gap-1">
                            <button type="button" aria-label={`Rename ${category.name}`} onClick={() => renameCategory(category)}
                                className="rounded-lg p-2 text-[var(--rp-muted)] hover:text-[var(--rp-text)]"><Pencil size={16} /></button>
                            <button type="button" aria-label={`Delete ${category.name}`} onClick={() => deleteCategory(category)}
                                className="rounded-lg p-2 text-[var(--rp-muted)] hover:text-[var(--rp-danger)]"><Trash2 size={16} /></button>
                        </div>
                    </div>

                    <ul className="divide-y divide-[var(--rp-line)]">
                        {(itemsByCategory.get(category.id) ?? []).map((item) => (
                            <li key={item.id} className="flex flex-wrap items-center gap-3 py-2">
                                <div className="min-w-0 flex-1">
                                    <p className="flex items-center gap-2 text-sm font-semibold text-[var(--rp-text)]">
                                        {item.isVeg && <Leaf size={14} className="text-[var(--rp-success)]" aria-label="Vegetarian" />}
                                        {item.name}
                                        {item.isBestSeller && <Badge tone="primary">Bestseller</Badge>}
                                    </p>
                                    <p className="text-xs text-[var(--rp-muted)]">₹{item.price}{item.variants?.length ? ` · ${item.variants.length} sizes` : ''}</p>
                                </div>
                                <select aria-label={`Availability of ${item.name}`} value={item.availability}
                                    onChange={(e) => void run(() => cmsAPI.setAvailability(item.id, e.target.value as MenuItemAvailability))}
                                    className="rounded-lg border border-[var(--rp-line)] bg-[var(--rp-surface)] px-2 py-1 text-xs text-[var(--rp-text)]">
                                    {(Object.keys(AVAILABILITY_LABELS) as MenuItemAvailability[]).map((a) => (
                                        <option key={a} value={a}>{AVAILABILITY_LABELS[a]}</option>
                                    ))}
                                </select>
                                <button type="button" aria-label={`Edit ${item.name}`} onClick={() => setDraft(toDraft(item))}
                                    className="rounded-lg p-2 text-[var(--rp-muted)] hover:text-[var(--rp-text)]"><Pencil size={16} /></button>
                                <button type="button" aria-label={`Delete ${item.name}`}
                                    onClick={() => { if (window.confirm(`Delete "${item.name}"?`)) void run(() => cmsAPI.deleteItem(item.id)); }}
                                    className="rounded-lg p-2 text-[var(--rp-muted)] hover:text-[var(--rp-danger)]"><Trash2 size={16} /></button>
                            </li>
                        ))}
                    </ul>

                    <button type="button" onClick={() => setDraft(emptyDraft(category.id))}
                        className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--rp-primary)]">
                        <Plus size={16} /> Add item
                    </button>
                </Card>
            ))}

            <Card className="flex flex-wrap items-center gap-2">
                <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="New category, e.g. Biryani"
                    aria-label="New category name" className={`${inputClass} flex-1`}
                    onKeyDown={(e) => { if (e.key === 'Enter') addCategory(); }} />
                <Button onClick={addCategory} disabled={!newCategory.trim()}>Add category</Button>
            </Card>

            {draft && (
                <Card className="space-y-3" >
                    <h3 className="font-bold text-[var(--rp-text)]">{draft.id ? 'Edit item' : 'New item'}</h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-xs font-semibold text-[var(--rp-muted)]">Name
                            <input className={inputClass} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                        </label>
                        <label className="text-xs font-semibold text-[var(--rp-muted)]">Price (₹)
                            <input className={inputClass} inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
                        </label>
                        <label className="text-xs font-semibold text-[var(--rp-muted)]">Category
                            <select className={inputClass} value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
                                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </label>
                        <div className="flex items-end gap-4 text-sm text-[var(--rp-text)]">
                            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.isVeg}
                                onChange={(e) => setDraft({ ...draft, isVeg: e.target.checked })} /> Vegetarian</label>
                            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.isBestSeller}
                                onChange={(e) => setDraft({ ...draft, isBestSeller: e.target.checked })} /> Bestseller</label>
                        </div>
                    </div>
                    <label className="block text-xs font-semibold text-[var(--rp-muted)]">Description
                        <textarea className={inputClass} rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                    </label>
                    <div className="grid gap-3 sm:grid-cols-3">
                        <label className="text-xs font-semibold text-[var(--rp-muted)]">Photo links (one per line, https)
                            <textarea className={inputClass} rows={3} value={draft.images} onChange={(e) => setDraft({ ...draft, images: e.target.value })} />
                        </label>
                        <label className="text-xs font-semibold text-[var(--rp-muted)]">Sizes ("Half: 260")
                            <textarea className={inputClass} rows={3} value={draft.variants} onChange={(e) => setDraft({ ...draft, variants: e.target.value })} />
                        </label>
                        <label className="text-xs font-semibold text-[var(--rp-muted)]">Add-ons ("Extra cheese: 40")
                            <textarea className={inputClass} rows={3} value={draft.addons} onChange={(e) => setDraft({ ...draft, addons: e.target.value })} />
                        </label>
                    </div>
                    <div className="flex gap-2">
                        <Button onClick={() => void saveItem()} disabled={saving}>{saving ? 'Saving…' : 'Save item'}</Button>
                        <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
                    </div>
                </Card>
            )}
        </div>
    );
};

export default MenuEditor;
