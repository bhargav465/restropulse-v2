import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PublicMenuItem } from '../types';
import { formatMoney } from '../lib/format';
import { roundMoney, MAX_QTY_PER_LINE } from '../lib/cart';
import { useCart } from '../store/CartContext';
import { useStorefront } from '../store/StorefrontContext';

interface ItemModalProps {
  item: PublicMenuItem;
  onClose: () => void;
}

const ItemModal: React.FC<ItemModalProps> = ({ item, onClose }) => {
  const { currency } = useStorefront();
  const { addItem } = useCart();
  const [variantId, setVariantId] = useState<string | undefined>(item.variants[0]?.id);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Escape to close + initial focus (keyboard accessible)
  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // Basic focus trap
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, input, select, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const selectedVariant = item.variants.find((v) => v.id === variantId);
  const selectedAddons = item.addons.filter((a) => addonIds.includes(a.id));

  const unitPrice = selectedVariant ? selectedVariant.price : item.price;
  const totalPrice = useMemo(
    () => roundMoney((unitPrice + selectedAddons.reduce((s, a) => s + a.price, 0)) * qty),
    [unitPrice, selectedAddons, qty],
  );

  const toggleAddon = (id: string) => {
    setAddonIds((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  };

  const handleAdd = () => {
    if (item.soldOut) return;
    addItem({
      menuItemId: item.id,
      name: item.name,
      isVeg: item.isVeg,
      image: item.images[0],
      basePrice: item.price,
      ...(selectedVariant ? { variant: { id: selectedVariant.id, name: selectedVariant.name, price: selectedVariant.price } } : {}),
      addons: selectedAddons.map((a) => ({ id: a.id, name: a.name, price: a.price })),
      qty,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true"></div>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-modal-title"
        className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl relative z-10 max-h-[90vh] overflow-y-auto"
      >
        {item.images[0] && (
          <img src={item.images[0]} alt={item.name} className="w-full h-44 object-cover rounded-t-3xl" />
        )}
        <div className="p-5">
          <div className="flex items-start justify-between gap-3 mb-1">
            <h2 id="item-modal-title" className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <span
                className={`inline-block w-3.5 h-3.5 border-2 rounded-sm shrink-0 ${item.isVeg ? 'border-green-600' : 'border-red-600'}`}
                role="img"
                aria-label={item.isVeg ? 'Vegetarian' : 'Non-vegetarian'}
              >
                <span className={`block w-1.5 h-1.5 rounded-full m-auto mt-[1px] ${item.isVeg ? 'bg-green-600' : 'bg-red-600'}`}></span>
              </span>
              {item.name}
            </h2>
            <button
              ref={closeButtonRef}
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 font-bold shrink-0"
            >
              ✕
            </button>
          </div>
          {item.description && <p className="text-sm text-slate-500 mb-3">{item.description}</p>}
          {item.soldOut && (
            <p className="text-sm font-semibold text-red-600 mb-3" role="status">Currently sold out</p>
          )}

          {item.variants.length > 0 && (
            <fieldset className="mb-4">
              <legend className="text-sm font-bold text-slate-700 mb-2">Choose an option</legend>
              <div className="space-y-2">
                {item.variants.map((v) => (
                  <label key={v.id} className="flex items-center justify-between p-3 rounded-xl border border-slate-200 has-checked:border-[var(--sf-primary)] cursor-pointer">
                    <span className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name="variant"
                        checked={variantId === v.id}
                        onChange={() => setVariantId(v.id)}
                        className="accent-[var(--sf-primary)]"
                      />
                      {v.name}
                    </span>
                    <span className="text-sm font-semibold text-slate-700">{formatMoney(v.price, currency)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {item.addons.length > 0 && (
            <fieldset className="mb-4">
              <legend className="text-sm font-bold text-slate-700 mb-2">Add-ons</legend>
              <div className="space-y-2">
                {item.addons.map((a) => (
                  <label key={a.id} className="flex items-center justify-between p-3 rounded-xl border border-slate-200 cursor-pointer">
                    <span className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={addonIds.includes(a.id)}
                        onChange={() => toggleAddon(a.id)}
                        className="accent-[var(--sf-primary)]"
                      />
                      {a.name}
                    </span>
                    <span className="text-sm font-semibold text-slate-700">+ {formatMoney(a.price, currency)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div className="flex items-center justify-between gap-3 mt-5">
            <div className="flex items-center border border-slate-200 rounded-xl" role="group" aria-label="Quantity">
              <button
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                aria-label="Decrease quantity"
                className="w-10 h-10 text-lg font-bold text-slate-600 hover:bg-slate-50 rounded-l-xl"
              >
                −
              </button>
              <span className="w-8 text-center text-sm font-bold" aria-live="polite">{qty}</span>
              <button
                onClick={() => setQty((q) => Math.min(MAX_QTY_PER_LINE, q + 1))}
                aria-label="Increase quantity"
                className="w-10 h-10 text-lg font-bold text-slate-600 hover:bg-slate-50 rounded-r-xl"
              >
                +
              </button>
            </div>
            <button
              onClick={handleAdd}
              disabled={item.soldOut}
              className="flex-1 py-3 rounded-xl bg-[var(--sf-primary)] text-white font-bold text-sm hover:opacity-90 disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              {item.soldOut ? 'Sold out' : `Add for ${formatMoney(totalPrice, currency)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ItemModal;
