import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, UploadCloud, X } from 'lucide-react';
import { MenuCategory, OrderingMenuItem, MenuItemAvailability, MenuItemVariant, MenuItemAddon } from '@restropulse/shared';
import { orderingAdminAPI, MenuCsvImportReport } from '../../api';
import { ActionNotice } from '../ActionNotice';
import ConfirmDialog from '../ConfirmDialog';
import { PanelLoading, PanelError, PanelEmpty } from './PanelStates';

const AVAILABILITY_OPTIONS: Array<{ value: MenuItemAvailability; label: string }> = [
    { value: 'in_stock', label: 'In stock' },
    { value: 'out_of_stock', label: 'Out of stock' },
    { value: 'hidden', label: 'Hidden' },
];

const AVAILABILITY_BADGE: Record<MenuItemAvailability, string> = {
    in_stock: 'bg-emerald-50 text-emerald-700',
    out_of_stock: 'bg-amber-50 text-amber-700',
    hidden: 'bg-slate-100 text-slate-500',
};

// ---------- Bottom-sheet modal (same pattern as Inputs.tsx, without history coupling) ----------
const Sheet = ({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) => {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="absolute inset-0" onClick={onClose}></div>
            <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl animate-in slide-in-from-bottom duration-300 relative z-10 max-h-[85vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-5">
                    <h3 className="text-lg font-bold text-slate-800">{title}</h3>
                    <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200">
                        <X size={16} />
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
};

const inputCls = 'w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/30';
const labelCls = 'block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5';

// ---------- Variant / addon rows editor ----------
type OptionRow = { id?: string; name: string; price: string };

const OptionRowsEditor: React.FC<{ label: string; rows: OptionRow[]; onChange: (rows: OptionRow[]) => void; addLabel: string }> = ({ label, rows, onChange, addLabel }) => (
    <div>
        <span className={labelCls}>{label}</span>
        <div className="space-y-2">
            {rows.map((row, i) => (
                <div key={i} className="flex gap-2 items-center">
                    <input
                        className={inputCls}
                        placeholder="Name"
                        aria-label={`${label} ${i + 1} name`}
                        value={row.name}
                        onChange={(e) => onChange(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                    />
                    <input
                        className={`${inputCls} w-24 shrink-0`}
                        placeholder="Price"
                        aria-label={`${label} ${i + 1} price`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.price}
                        onChange={(e) => onChange(rows.map((r, j) => (j === i ? { ...r, price: e.target.value } : r)))}
                    />
                    <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove ${label.toLowerCase()} ${i + 1}`} className="w-9 h-9 shrink-0 rounded-xl bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-100">
                        <Trash2 size={14} />
                    </button>
                </div>
            ))}
            <button type="button" onClick={() => onChange([...rows, { name: '', price: '' }])} className="text-xs font-bold text-orange-600 hover:text-orange-700 flex items-center gap-1">
                <Plus size={14} /> {addLabel}
            </button>
        </div>
    </div>
);

function toOptionRows(list?: Array<MenuItemVariant | MenuItemAddon>): OptionRow[] {
    return (list ?? []).map((v) => ({ id: v.id, name: v.name, price: String(v.price) }));
}

function fromOptionRows(rows: OptionRow[]): Array<{ id?: string; name: string; price: number }> {
    return rows
        .filter((r) => r.name.trim())
        .map((r) => ({ ...(r.id ? { id: r.id } : {}), name: r.name.trim(), price: Number(r.price) || 0 }));
}

// ---------- Item form state ----------
interface ItemFormState {
    id?: string;
    categoryId: string;
    name: string;
    description: string;
    price: string;
    imageUrl: string;
    isVeg: boolean;
    availability: MenuItemAvailability;
    variants: OptionRow[];
    addons: OptionRow[];
}

const emptyItemForm = (categoryId: string): ItemFormState => ({
    categoryId, name: '', description: '', price: '', imageUrl: '', isVeg: false, availability: 'in_stock', variants: [], addons: [],
});

const MenuManager: React.FC = () => {
    const [categories, setCategories] = useState<MenuCategory[] | null>(null);
    const [items, setItems] = useState<OrderingMenuItem[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
    const [saving, setSaving] = useState(false);

    // Editors
    const [categoryForm, setCategoryForm] = useState<{ id?: string; name: string; description: string } | null>(null);
    const [itemForm, setItemForm] = useState<ItemFormState | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<{ kind: 'category' | 'item'; id: string; name: string } | null>(null);

    // CSV import
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [importing, setImporting] = useState(false);
    const [importReport, setImportReport] = useState<MenuCsvImportReport | null>(null);

    const load = useCallback(async () => {
        setCategories(null);
        setItems(null);
        setError(null);
        try {
            const [cats, its] = await Promise.all([orderingAdminAPI.getCategories(), orderingAdminAPI.getItems()]);
            setCategories(cats);
            setItems(its);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load menu');
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const fail = (err: unknown, fallback: string) => setNotice({ message: err instanceof Error ? err.message : fallback, type: 'error' });

    // ---------- Category CRUD ----------
    const saveCategory = async () => {
        if (!categoryForm || !categoryForm.name.trim()) return;
        setSaving(true);
        try {
            if (categoryForm.id) {
                const updated = await orderingAdminAPI.updateCategory(categoryForm.id, { name: categoryForm.name.trim(), description: categoryForm.description.trim() });
                setCategories((prev) => prev?.map((c) => (c.id === updated.id ? updated : c)) ?? prev);
            } else {
                const created = await orderingAdminAPI.createCategory({ name: categoryForm.name.trim(), ...(categoryForm.description.trim() ? { description: categoryForm.description.trim() } : {}) });
                setCategories((prev) => (prev ? [...prev, created] : [created]));
            }
            setCategoryForm(null);
        } catch (err) {
            fail(err, 'Failed to save category');
        } finally {
            setSaving(false);
        }
    };

    const moveCategory = async (index: number, direction: -1 | 1) => {
        if (!categories) return;
        const target = index + direction;
        if (target < 0 || target >= categories.length) return;
        const reordered = [...categories];
        [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
        setCategories(reordered); // optimistic
        try {
            const fresh = await orderingAdminAPI.reorderCategories(reordered.map((c) => c.id));
            if (fresh.length > 0) setCategories(fresh);
        } catch (err) {
            fail(err, 'Failed to reorder categories');
            load();
        }
    };

    // ---------- Item CRUD ----------
    const saveItem = async () => {
        if (!itemForm || !itemForm.name.trim() || !itemForm.categoryId) return;
        setSaving(true);
        const payload = {
            categoryId: itemForm.categoryId,
            name: itemForm.name.trim(),
            description: itemForm.description.trim(),
            price: Number(itemForm.price) || 0,
            images: itemForm.imageUrl.trim() ? [itemForm.imageUrl.trim()] : [],
            isVeg: itemForm.isVeg,
            availability: itemForm.availability,
            variants: fromOptionRows(itemForm.variants),
            addons: fromOptionRows(itemForm.addons),
        };
        try {
            if (itemForm.id) {
                const updated = await orderingAdminAPI.updateItem(itemForm.id, payload);
                setItems((prev) => prev?.map((i) => (i.id === updated.id ? updated : i)) ?? prev);
            } else {
                const created = await orderingAdminAPI.createItem(payload);
                setItems((prev) => (prev ? [...prev, created] : [created]));
            }
            setItemForm(null);
        } catch (err) {
            fail(err, 'Failed to save item');
        } finally {
            setSaving(false);
        }
    };

    const changeAvailability = async (item: OrderingMenuItem, availability: MenuItemAvailability) => {
        const previous = item.availability;
        setItems((prev) => prev?.map((i) => (i.id === item.id ? { ...i, availability } : i)) ?? prev); // optimistic
        try {
            await orderingAdminAPI.setItemAvailability(item.id, availability);
        } catch (err) {
            setItems((prev) => prev?.map((i) => (i.id === item.id ? { ...i, availability: previous } : i)) ?? prev);
            fail(err, 'Failed to update availability');
        }
    };

    const moveItem = async (categoryId: string, categoryItems: OrderingMenuItem[], index: number, direction: -1 | 1) => {
        const target = index + direction;
        if (target < 0 || target >= categoryItems.length) return;
        const reordered = [...categoryItems];
        [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
        const orderById = new Map(reordered.map((it, i) => [it.id, i + 1]));
        setItems((prev) => prev?.map((i) => (orderById.has(i.id) ? { ...i, sortOrder: orderById.get(i.id)! } : i)) ?? prev); // optimistic
        try {
            await orderingAdminAPI.reorderItems(categoryId, reordered.map((i) => i.id));
        } catch (err) {
            fail(err, 'Failed to reorder items');
            load();
        }
    };

    const performDelete = async () => {
        if (!confirmDelete) return;
        const { kind, id } = confirmDelete;
        setConfirmDelete(null);
        try {
            if (kind === 'category') {
                await orderingAdminAPI.deleteCategory(id);
                setCategories((prev) => prev?.filter((c) => c.id !== id) ?? prev);
            } else {
                await orderingAdminAPI.deleteItem(id);
                setItems((prev) => prev?.filter((i) => i.id !== id) ?? prev);
            }
        } catch (err) {
            fail(err, `Failed to delete ${kind}`);
        }
    };

    // ---------- CSV import ----------
    const handleCsvSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // allow re-selecting the same file
        if (!file) return;
        setImporting(true);
        setImportReport(null);
        try {
            const report = await orderingAdminAPI.importMenuCsv(file);
            setImportReport(report);
            load();
        } catch (err) {
            fail(err, 'CSV import failed');
        } finally {
            setImporting(false);
        }
    };

    // ---------- Render ----------
    if (error) return <PanelError message={error} onRetry={load} />;
    if (categories === null || items === null) return <PanelLoading label="Loading menu…" />;

    const itemsByCategory = (categoryId: string) =>
        items.filter((i) => i.categoryId === categoryId).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

    return (
        <div className="space-y-4">
            {notice && <ActionNotice message={notice.message} type={notice.type} onDismiss={() => setNotice(null)} />}

            {/* Toolbar */}
            <div className="flex gap-2">
                <button onClick={() => setCategoryForm({ name: '', description: '' })} className="flex-1 py-2.5 rounded-xl bg-orange-600 text-white text-xs font-bold hover:bg-orange-700 active:scale-[0.98] transition-all flex items-center justify-center gap-1.5">
                    <Plus size={14} strokeWidth={2.5} /> Add category
                </button>
                <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={importing}
                    className="flex-1 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                    <UploadCloud size={14} strokeWidth={2.5} /> {importing ? 'Importing…' : 'Import CSV'}
                </button>
                <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsvSelected} aria-label="Menu CSV file" />
            </div>

            {/* CSV import report */}
            {importReport && (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                    <div className="flex items-start justify-between mb-2">
                        <p className="text-sm font-bold text-slate-800">CSV import report</p>
                        <button onClick={() => setImportReport(null)} aria-label="Dismiss import report" className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                    </div>
                    <p className="text-xs text-slate-600 font-medium mb-2">
                        {importReport.created} created · {importReport.updated} updated · {importReport.failed} failed
                    </p>
                    {importReport.errors.length > 0 && (
                        <ul className="space-y-1">
                            {importReport.errors.map((rowErr) => (
                                <li key={rowErr.row} className="text-xs text-red-600 bg-red-50 rounded-lg px-2.5 py-1.5">
                                    Row {rowErr.row}: {rowErr.errors.join('; ')}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {categories.length === 0 ? (
                <PanelEmpty title="No menu yet" hint="Create a category to start building your menu, or import a CSV." />
            ) : (
                categories.map((category, catIndex) => {
                    const categoryItems = itemsByCategory(category.id);
                    return (
                        <div key={category.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm">
                            {/* Category header */}
                            <div className="flex items-center gap-2 p-4 border-b border-slate-100">
                                <div className="flex-1 min-w-0">
                                    <p className="font-extrabold text-slate-800 text-sm truncate">{category.name}</p>
                                    {category.description && <p className="text-xs text-slate-400 truncate">{category.description}</p>}
                                </div>
                                <button onClick={() => moveCategory(catIndex, -1)} disabled={catIndex === 0} aria-label={`Move ${category.name} up`} className="w-8 h-8 rounded-lg bg-slate-50 text-slate-500 flex items-center justify-center hover:bg-slate-100 disabled:opacity-30"><ChevronUp size={16} /></button>
                                <button onClick={() => moveCategory(catIndex, 1)} disabled={catIndex === categories.length - 1} aria-label={`Move ${category.name} down`} className="w-8 h-8 rounded-lg bg-slate-50 text-slate-500 flex items-center justify-center hover:bg-slate-100 disabled:opacity-30"><ChevronDown size={16} /></button>
                                <button onClick={() => setCategoryForm({ id: category.id, name: category.name, description: category.description ?? '' })} aria-label={`Edit ${category.name}`} className="w-8 h-8 rounded-lg bg-slate-50 text-slate-500 flex items-center justify-center hover:bg-slate-100"><Pencil size={14} /></button>
                                <button onClick={() => setConfirmDelete({ kind: 'category', id: category.id, name: category.name })} aria-label={`Delete ${category.name}`} className="w-8 h-8 rounded-lg bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-100"><Trash2 size={14} /></button>
                            </div>

                            {/* Items */}
                            {categoryItems.length === 0 ? (
                                <p className="text-xs text-slate-400 px-4 py-3">No items in this category.</p>
                            ) : (
                                <ul>
                                    {categoryItems.map((item, itemIndex) => (
                                        <li key={item.id} className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-50 last:border-b-0">
                                            {item.images?.[0] && (
                                                <img
                                                    src={item.images[0]}
                                                    alt=""
                                                    loading="lazy"
                                                    className="w-11 h-11 rounded-lg object-cover shrink-0 border border-slate-100 bg-slate-50"
                                                />
                                            )}
                                            <span className={`w-2.5 h-2.5 rounded-full shrink-0 border ${item.isVeg ? 'bg-green-500 border-green-600' : 'bg-red-500 border-red-600'}`} aria-label={item.isVeg ? 'Veg' : 'Non-veg'}></span>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-bold text-slate-700 truncate">{item.name}</p>
                                                <p className="text-xs text-slate-400">
                                                    ₹{item.price.toFixed(2)}
                                                    {(item.variants?.length ?? 0) > 0 && ` · ${item.variants!.length} variants`}
                                                    {(item.addons?.length ?? 0) > 0 && ` · ${item.addons!.length} addons`}
                                                </p>
                                            </div>
                                            <select
                                                value={item.availability}
                                                onChange={(e) => changeAvailability(item, e.target.value as MenuItemAvailability)}
                                                aria-label={`${item.name} availability`}
                                                className={`text-[10px] font-bold rounded-full px-2 py-1 border-0 ${AVAILABILITY_BADGE[item.availability]}`}
                                            >
                                                {AVAILABILITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                            </select>
                                            <button onClick={() => moveItem(category.id, categoryItems, itemIndex, -1)} disabled={itemIndex === 0} aria-label={`Move ${item.name} up`} className="w-7 h-7 rounded-lg bg-slate-50 text-slate-500 flex items-center justify-center hover:bg-slate-100 disabled:opacity-30"><ChevronUp size={14} /></button>
                                            <button onClick={() => moveItem(category.id, categoryItems, itemIndex, 1)} disabled={itemIndex === categoryItems.length - 1} aria-label={`Move ${item.name} down`} className="w-7 h-7 rounded-lg bg-slate-50 text-slate-500 flex items-center justify-center hover:bg-slate-100 disabled:opacity-30"><ChevronDown size={14} /></button>
                                            <button
                                                onClick={() => setItemForm({
                                                    id: item.id,
                                                    categoryId: item.categoryId,
                                                    name: item.name,
                                                    description: item.description ?? '',
                                                    price: String(item.price),
                                                    imageUrl: item.images?.[0] ?? '',
                                                    isVeg: item.isVeg,
                                                    availability: item.availability,
                                                    variants: toOptionRows(item.variants),
                                                    addons: toOptionRows(item.addons),
                                                })}
                                                aria-label={`Edit ${item.name}`}
                                                className="w-7 h-7 rounded-lg bg-slate-50 text-slate-500 flex items-center justify-center hover:bg-slate-100"
                                            ><Pencil size={12} /></button>
                                            <button onClick={() => setConfirmDelete({ kind: 'item', id: item.id, name: item.name })} aria-label={`Delete ${item.name}`} className="w-7 h-7 rounded-lg bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-100"><Trash2 size={12} /></button>
                                        </li>
                                    ))}
                                </ul>
                            )}

                            <div className="p-3">
                                <button onClick={() => setItemForm(emptyItemForm(category.id))} className="text-xs font-bold text-orange-600 hover:text-orange-700 flex items-center gap-1">
                                    <Plus size={14} /> Add item
                                </button>
                            </div>
                        </div>
                    );
                })
            )}

            {/* Category form sheet */}
            {categoryForm && (
                <Sheet title={categoryForm.id ? 'Edit category' : 'New category'} onClose={() => setCategoryForm(null)}>
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="category-name" className={labelCls}>Name</label>
                            <input id="category-name" className={inputCls} value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} placeholder="e.g. Starters" />
                        </div>
                        <div>
                            <label htmlFor="category-description" className={labelCls}>Description (optional)</label>
                            <input id="category-description" className={inputCls} value={categoryForm.description} onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })} placeholder="Short blurb" />
                        </div>
                        <button onClick={saveCategory} disabled={saving || !categoryForm.name.trim()} className="w-full py-3.5 rounded-2xl bg-orange-600 text-white font-bold text-sm hover:bg-orange-700 active:scale-[0.98] transition-all disabled:opacity-50">
                            {saving ? 'Saving…' : 'Save category'}
                        </button>
                    </div>
                </Sheet>
            )}

            {/* Item form sheet */}
            {itemForm && (
                <Sheet title={itemForm.id ? 'Edit item' : 'New item'} onClose={() => setItemForm(null)}>
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="item-name" className={labelCls}>Name</label>
                            <input id="item-name" className={inputCls} value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} placeholder="e.g. Paneer Tikka" />
                        </div>
                        <div>
                            <label htmlFor="item-category" className={labelCls}>Category</label>
                            <select id="item-category" className={inputCls} value={itemForm.categoryId} onChange={(e) => setItemForm({ ...itemForm, categoryId: e.target.value })}>
                                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="item-description" className={labelCls}>Description (optional)</label>
                            <textarea id="item-description" className={inputCls} rows={2} value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} />
                        </div>
                        <div className="flex gap-3">
                            <div className="flex-1">
                                <label htmlFor="item-price" className={labelCls}>Base price</label>
                                <input id="item-price" className={inputCls} type="number" min="0" step="0.01" value={itemForm.price} onChange={(e) => setItemForm({ ...itemForm, price: e.target.value })} />
                            </div>
                            <div className="flex-1">
                                <label htmlFor="item-availability" className={labelCls}>Availability</label>
                                <select id="item-availability" className={inputCls} value={itemForm.availability} onChange={(e) => setItemForm({ ...itemForm, availability: e.target.value as MenuItemAvailability })}>
                                    {AVAILABILITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </div>
                        </div>
                        <div>
                            <label htmlFor="item-image-url" className={labelCls}>Image URL (optional)</label>
                            <input id="item-image-url" className={inputCls} type="url" value={itemForm.imageUrl} onChange={(e) => setItemForm({ ...itemForm, imageUrl: e.target.value })} placeholder="https://…" />
                        </div>
                        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                            <input type="checkbox" checked={itemForm.isVeg} onChange={(e) => setItemForm({ ...itemForm, isVeg: e.target.checked })} className="w-4 h-4 accent-green-600" />
                            Vegetarian
                        </label>
                        <OptionRowsEditor label="Variants" addLabel="Add variant" rows={itemForm.variants} onChange={(rows) => setItemForm({ ...itemForm, variants: rows })} />
                        <OptionRowsEditor label="Addons" addLabel="Add addon" rows={itemForm.addons} onChange={(rows) => setItemForm({ ...itemForm, addons: rows })} />
                        <button onClick={saveItem} disabled={saving || !itemForm.name.trim() || itemForm.price === ''} className="w-full py-3.5 rounded-2xl bg-orange-600 text-white font-bold text-sm hover:bg-orange-700 active:scale-[0.98] transition-all disabled:opacity-50">
                            {saving ? 'Saving…' : 'Save item'}
                        </button>
                    </div>
                </Sheet>
            )}

            {/* Delete confirmation */}
            {confirmDelete && (
                <ConfirmDialog
                    title={`Delete ${confirmDelete.kind}?`}
                    message={`"${confirmDelete.name}" will be permanently removed${confirmDelete.kind === 'category' ? '. Categories must be empty before deletion.' : '.'}`}
                    confirmLabel="Delete"
                    onConfirm={performDelete}
                    onCancel={() => setConfirmDelete(null)}
                />
            )}
        </div>
    );
};

export default MenuManager;
