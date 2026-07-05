import React, { useEffect, useMemo, useState } from 'react';
import { useStorefront } from '../store/StorefrontContext';
import { storefrontAPI } from '../api';
import type { PublicMenuCategory, PublicMenuItem } from '../types';
import { formatMoney } from '../lib/format';
import { track } from '../lib/analytics';
import { Loading, ErrorState, EmptyState } from '../components/States';
import ItemModal from '../components/ItemModal';

type VegFilter = 'all' | 'veg' | 'non_veg';

const PRICE_FILTERS: Array<{ label: string; max: number | null }> = [
  { label: 'Any price', max: null },
  { label: 'Under 100', max: 100 },
  { label: 'Under 250', max: 250 },
  { label: 'Under 500', max: 500 },
];

const MenuPage: React.FC = () => {
  const { slug, currency } = useStorefront();
  const [categories, setCategories] = useState<PublicMenuCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [vegFilter, setVegFilter] = useState<VegFilter>('all');
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<PublicMenuItem | null>(null);

  useEffect(() => {
    track(slug, 'menu_view');
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setCategories(null);
    storefrontAPI
      .getMenu(slug)
      .then((cats) => { if (!cancelled) setCategories(cats); })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load the menu');
      });
    return () => { cancelled = true; };
  }, [slug, reloadKey]);

  const filtered = useMemo(() => {
    if (!categories) return [];
    const q = search.trim().toLowerCase();
    return categories
      .map((cat) => ({
        ...cat,
        items: cat.items.filter((item) => {
          if (vegFilter === 'veg' && !item.isVeg) return false;
          if (vegFilter === 'non_veg' && item.isVeg) return false;
          if (maxPrice !== null && item.price > maxPrice) return false;
          if (q && !`${item.name} ${item.description ?? ''}`.toLowerCase().includes(q)) return false;
          return true;
        }),
      }))
      .filter((cat) => cat.items.length > 0);
  }, [categories, search, vegFilter, maxPrice]);

  const openItem = (item: PublicMenuItem) => {
    setSelectedItem(item);
    track(slug, 'item_view', { menuItemId: item.id, name: item.name });
  };

  if (error) return <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />;
  if (categories === null) return <Loading label="Loading menu…" />;
  if (categories.length === 0) {
    return <EmptyState title="Menu coming soon" text="This restaurant hasn't published a menu yet." />;
  }

  return (
    <div>
      <h1 className="text-xl font-extrabold text-slate-800 mb-4">Menu</h1>

      {/* Search + filters */}
      <div className="space-y-3 mb-4">
        <div>
          <label htmlFor="menu-search" className="sr-only">Search the menu</label>
          <input
            id="menu-search"
            type="search"
            placeholder="Search dishes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sf-primary)]"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl bg-white border border-slate-200 p-0.5" role="group" aria-label="Dietary filter">
            {([['all', 'All'], ['veg', 'Veg'], ['non_veg', 'Non-veg']] as Array<[VegFilter, string]>).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setVegFilter(value)}
                aria-pressed={vegFilter === value}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${vegFilter === value ? 'bg-[var(--sf-primary)] text-white' : 'text-slate-600'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <label htmlFor="price-filter" className="sr-only">Maximum price</label>
          <select
            id="price-filter"
            value={maxPrice === null ? '' : String(maxPrice)}
            onChange={(e) => setMaxPrice(e.target.value === '' ? null : Number(e.target.value))}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600"
          >
            {PRICE_FILTERS.map((f) => (
              <option key={f.label} value={f.max === null ? '' : String(f.max)}>{f.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Category nav */}
      <nav aria-label="Menu categories" className="sticky top-24 z-20 -mx-4 px-4 py-2 bg-slate-50/95 backdrop-blur overflow-x-auto no-scrollbar mb-4">
        <ul className="flex gap-2">
          {filtered.map((cat) => (
            <li key={cat.id}>
              <a
                href={`#cat-${cat.id}`}
                onClick={() => setActiveCategory(cat.id)}
                className={`block px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap border ${
                  activeCategory === cat.id
                    ? 'bg-[var(--sf-primary)] text-white border-transparent'
                    : 'bg-white text-slate-600 border-slate-200'
                }`}
              >
                {cat.name}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {filtered.length === 0 ? (
        <EmptyState title="No dishes match" text="Try a different search term or clear the filters." />
      ) : (
        filtered.map((cat) => (
          <section key={cat.id} id={`cat-${cat.id}`} aria-labelledby={`cat-heading-${cat.id}`} className="mb-8 scroll-mt-36">
            <h2 id={`cat-heading-${cat.id}`} className="text-lg font-bold text-slate-800 mb-1">{cat.name}</h2>
            {cat.description && <p className="text-sm text-slate-500 mb-3">{cat.description}</p>}
            <ul className="space-y-3">
              {cat.items.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => openItem(item)}
                    aria-label={`${item.name}, ${formatMoney(item.price, currency)}${item.soldOut ? ', sold out' : ''}`}
                    className={`w-full text-left bg-white rounded-2xl border border-slate-200 p-3 flex gap-3 items-start hover:border-[var(--sf-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--sf-primary)] ${item.soldOut ? 'opacity-50 grayscale' : ''}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        <span
                          className={`inline-block w-3 h-3 border-2 rounded-sm shrink-0 ${item.isVeg ? 'border-green-600' : 'border-red-600'}`}
                          role="img"
                          aria-label={item.isVeg ? 'Vegetarian' : 'Non-vegetarian'}
                        ></span>
                        {item.name}
                      </p>
                      {item.description && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{item.description}</p>}
                      <p className="text-sm font-semibold text-slate-700 mt-1.5">
                        {formatMoney(item.price, currency)}
                        {item.variants.length > 0 && <span className="text-xs font-normal text-slate-400"> · options available</span>}
                      </p>
                      {item.soldOut && <p className="text-xs font-bold text-red-600 mt-1">Sold out</p>}
                    </div>
                    {item.images[0] && (
                      <img src={item.images[0]} alt="" className="w-20 h-20 rounded-xl object-cover shrink-0" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {selectedItem && <ItemModal item={selectedItem} onClose={() => setSelectedItem(null)} />}
    </div>
  );
};

export default MenuPage;
