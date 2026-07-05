import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { CustomerAddress, Order } from '@restropulse/shared';
import { useStorefront } from '../store/StorefrontContext';
import { useAuth } from '../store/AuthContext';
import { useCart } from '../store/CartContext';
import { addressAPI, orderAPI } from '../api';
import { formatDate, formatMoney } from '../lib/format';
import AuthForms from '../components/AuthForms';
import { Loading, ErrorState, EmptyState } from '../components/States';

type Tab = 'profile' | 'addresses' | 'orders';

const AccountPage: React.FC = () => {
  const { slug, currency } = useStorefront();
  const { isLoggedIn, customer, logout } = useAuth();
  const { addItem } = useCart();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>('profile');
  const [addresses, setAddresses] = useState<CustomerAddress[] | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [newAddress, setNewAddress] = useState({ label: '', line1: '', line2: '', city: '', pincode: '', phone: '' });
  const [addingAddress, setAddingAddress] = useState(false);

  useEffect(() => {
    if (!isLoggedIn) return;
    if (tab === 'addresses' && addresses === null) {
      addressAPI.list(slug)
        .then(setAddresses)
        .catch((err: unknown) => setAddressError(err instanceof Error ? err.message : 'Failed to load addresses'));
    }
    if (tab === 'orders' && orders === null) {
      orderAPI.list(slug)
        .then(setOrders)
        .catch((err: unknown) => setOrdersError(err instanceof Error ? err.message : 'Failed to load orders'));
    }
  }, [tab, isLoggedIn, slug, addresses, orders]);

  if (!isLoggedIn) {
    return (
      <div className="max-w-md mx-auto">
        <h1 className="text-xl font-extrabold text-slate-800 mb-1">Your account</h1>
        <p className="text-sm text-slate-500 mb-4">Sign in to see your profile, addresses and orders.</p>
        <AuthForms intent="account" />
      </div>
    );
  }

  const handleAddAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAddress.line1.trim()) return;
    setAddingAddress(true);
    setAddressError(null);
    try {
      const created = await addressAPI.add(slug, {
        line1: newAddress.line1,
        ...(newAddress.label.trim() ? { label: newAddress.label.trim() } : {}),
        ...(newAddress.line2.trim() ? { line2: newAddress.line2.trim() } : {}),
        ...(newAddress.city.trim() ? { city: newAddress.city.trim() } : {}),
        ...(newAddress.pincode.trim() ? { pincode: newAddress.pincode.trim() } : {}),
        ...(newAddress.phone.trim() ? { phone: newAddress.phone.trim() } : {}),
      });
      setAddresses((prev) => [...(prev ?? []), created]);
      setNewAddress({ label: '', line1: '', line2: '', city: '', pincode: '', phone: '' });
    } catch (err) {
      setAddressError(err instanceof Error ? err.message : 'Failed to add address');
    } finally {
      setAddingAddress(false);
    }
  };

  const handleReorder = (order: Order) => {
    for (const item of order.items) {
      addItem({
        menuItemId: item.menuItemId,
        name: item.name,
        isVeg: false, // dietary flag is not part of the order snapshot
        basePrice: item.unitPrice,
        ...(item.variant ? { variant: item.variant } : {}),
        addons: item.addons ?? [],
        qty: item.qty,
      });
    }
    navigate(`/${slug}/cart`);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-extrabold text-slate-800">Your account</h1>
        <button onClick={logout} className="text-sm font-semibold text-red-600 hover:underline">Sign out</button>
      </div>

      <div className="flex rounded-xl bg-white border border-slate-200 p-1 mb-5" role="tablist" aria-label="Account sections">
        {([['profile', 'Profile'], ['addresses', 'Addresses'], ['orders', 'Orders']] as Array<[Tab, string]>).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`flex-1 py-2 rounded-lg text-sm font-bold ${tab === value ? 'bg-[var(--sf-primary)] text-white' : 'text-slate-500'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="text-sm font-bold text-slate-700 mb-3">Profile</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Name</dt><dd className="font-medium text-slate-700">{customer?.name || '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Email</dt><dd className="font-medium text-slate-700">{customer?.email}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Phone</dt><dd className="font-medium text-slate-700">{customer?.phone || '—'}</dd></div>
          </dl>
        </div>
      )}

      {tab === 'addresses' && (
        <div className="space-y-4">
          {addressError && <ErrorState message={addressError} onRetry={() => { setAddressError(null); setAddresses(null); }} />}
          {!addressError && addresses === null && <Loading label="Loading addresses…" />}
          {!addressError && addresses !== null && (
            <>
              {addresses.length === 0 ? (
                <p className="text-sm text-slate-500">No saved addresses yet.</p>
              ) : (
                <ul className="space-y-2">
                  {addresses.map((a) => (
                    <li key={a.id} className="bg-white rounded-2xl border border-slate-200 p-4 text-sm">
                      {a.label && <p className="font-bold text-slate-700 mb-0.5">{a.label}</p>}
                      <p className="text-slate-600">
                        {a.line1}{a.line2 ? `, ${a.line2}` : ''}{a.city ? `, ${a.city}` : ''}{a.pincode ? ` — ${a.pincode}` : ''}
                      </p>
                      {a.phone && <p className="text-slate-400 text-xs mt-0.5">{a.phone}</p>}
                    </li>
                  ))}
                </ul>
              )}

              <form onSubmit={handleAddAddress} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
                <h2 className="text-sm font-bold text-slate-700">Add a new address</h2>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="new-label" className="block text-xs font-bold text-slate-600 mb-1">Label</label>
                    <input id="new-label" type="text" placeholder="Home / Work" value={newAddress.label} onChange={(e) => setNewAddress((s) => ({ ...s, label: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
                  </div>
                  <div>
                    <label htmlFor="new-phone" className="block text-xs font-bold text-slate-600 mb-1">Phone</label>
                    <input id="new-phone" type="tel" value={newAddress.phone} onChange={(e) => setNewAddress((s) => ({ ...s, phone: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
                  </div>
                </div>
                <div>
                  <label htmlFor="new-line1" className="block text-xs font-bold text-slate-600 mb-1">Address line 1 *</label>
                  <input id="new-line1" type="text" required value={newAddress.line1} onChange={(e) => setNewAddress((s) => ({ ...s, line1: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
                </div>
                <div>
                  <label htmlFor="new-line2" className="block text-xs font-bold text-slate-600 mb-1">Address line 2</label>
                  <input id="new-line2" type="text" value={newAddress.line2} onChange={(e) => setNewAddress((s) => ({ ...s, line2: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="new-city" className="block text-xs font-bold text-slate-600 mb-1">City</label>
                    <input id="new-city" type="text" value={newAddress.city} onChange={(e) => setNewAddress((s) => ({ ...s, city: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
                  </div>
                  <div>
                    <label htmlFor="new-pincode" className="block text-xs font-bold text-slate-600 mb-1">Pincode</label>
                    <input id="new-pincode" type="text" inputMode="numeric" value={newAddress.pincode} onChange={(e) => setNewAddress((s) => ({ ...s, pincode: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
                  </div>
                </div>
                <button type="submit" disabled={addingAddress} className="w-full py-2.5 rounded-xl bg-[var(--sf-primary)] text-white text-sm font-bold hover:opacity-90 disabled:opacity-60">
                  {addingAddress ? 'Saving…' : 'Save address'}
                </button>
              </form>
            </>
          )}
        </div>
      )}

      {tab === 'orders' && (
        <div className="space-y-3">
          {ordersError && <ErrorState message={ordersError} onRetry={() => { setOrdersError(null); setOrders(null); }} />}
          {!ordersError && orders === null && <Loading label="Loading orders…" />}
          {!ordersError && orders !== null && orders.length === 0 && (
            <EmptyState
              title="No orders yet"
              text="Your order history will show up here."
              action={<Link to={`/${slug}/menu`} className="px-5 py-2.5 rounded-xl bg-[var(--sf-primary)] text-white text-sm font-bold">Browse menu</Link>}
            />
          )}
          {!ordersError && orders !== null && orders.map((order) => (
            <article key={order.id} className="bg-white rounded-2xl border border-slate-200 p-4" aria-label={`Order ${order.orderNumber}`}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <p className="text-sm font-bold text-slate-800">{order.orderNumber}</p>
                  <p className="text-xs text-slate-500">{formatDate(order.createdAt)} · {order.orderType.replace('_', '-')}</p>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-slate-100 text-slate-600">
                  {order.status.replace(/_/g, ' ')}
                </span>
              </div>
              <p className="text-xs text-slate-500 mb-2 line-clamp-2">
                {order.items.map((i) => `${i.qty} × ${i.name}`).join(', ')}
              </p>
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-slate-800">{formatMoney(order.totals.total, currency)}</p>
                <div className="flex gap-2">
                  <Link to={`/${slug}/track/${order.id}`} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">
                    Track
                  </Link>
                  <button onClick={() => handleReorder(order)} className="px-3 py-1.5 rounded-lg bg-[var(--sf-primary)] text-white text-xs font-bold hover:opacity-90">
                    Reorder
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

export default AccountPage;
