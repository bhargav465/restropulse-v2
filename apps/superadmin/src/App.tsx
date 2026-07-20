import { useCallback, useEffect, useState } from 'react';

/**
 * RestroPulse Super Admin — platform owner control panel.
 * Controls every restaurant, platform-wide feature flags, and the
 * marketing landing page content. Requires an ADMIN-role account
 * (auto-granted to SUPER_ADMIN_EMAIL at login).
 */

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const STOREFRONT_URL = import.meta.env.VITE_STOREFRONT_URL || 'https://restropulse-storefront.vercel.app';
const LANDING_URL = import.meta.env.VITE_LANDING_URL || 'https://restropulse-landingpage.vercel.app';
const ADMIN_URL = import.meta.env.VITE_ADMIN_URL || 'https://restropulse-admin.vercel.app';

const TOKEN_KEY = 'sa_token';

async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(localStorage.getItem(TOKEN_KEY) ? { authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json;
}

// ---------- Types ----------
interface RestaurantRow {
  id: string; name: string; slug: string | null; cuisine: string;
  storeOpen: boolean; suspended: boolean; createdAt: string | null;
  menuItems: number; orders: number; revenue: number;
}
interface Flags { ordering: boolean; reservations: boolean; dineIn: boolean; campaigns: boolean; contentEngine: boolean; intelligence: boolean; }
interface Plan { id: string; name: string; tagline: string; monthlyPrice: number; featured: boolean; badge?: string; order: number; active: boolean; cta: string; features: string[]; }
interface LandingSettings { currencySymbol: string; adminDemoUrl: string; yearlyMonthsCharged: number; }

// ---------- Login ----------
function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const id = email.includes('@') ? { email } : { phone: email };
      const res = await api<any>('POST', '/auth/login', { ...id, password });
      if (res.user?.role !== 'ADMIN') {
        throw new Error('This account is not a platform super admin.');
      }
      localStorage.setItem(TOKEN_KEY, res.token);
      onLogin();
    } catch (e: any) {
      setErr(e.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-box">
      <div className="center" style={{ marginBottom: 20 }}>
        <div className="brand" style={{ justifyContent: 'center' }}>
          <div className="logo">R</div>
        </div>
        <h1 style={{ margin: '12px 0 2px' }}>Super Admin</h1>
        <p className="muted" style={{ margin: 0 }}>RestroPulse platform control</p>
      </div>
      {err && <div className="msg err">{err}</div>}
      <form onSubmit={submit} className="card">
        <label>Email or phone</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoFocus />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        <button className="btn mt" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

// ---------- Restaurants ----------
function Restaurants() {
  const [rows, setRows] = useState<RestaurantRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ data: RestaurantRow[] }>('GET', '/super/restaurants')
      .then((r) => setRows(r.data))
      .catch((e) => setErr(e.message));
  }, []);
  useEffect(load, [load]);

  const patch = async (id: string, body: { storeOpen?: boolean; suspended?: boolean }) => {
    setBusy(id);
    try {
      const r = await api<{ data: { storeOpen: boolean; suspended: boolean } }>('PATCH', `/super/restaurants/${id}`, body);
      setRows((prev) => prev?.map((x) => (x.id === id ? { ...x, ...r.data } : x)) ?? prev);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (err) return <div className="msg err">{err}</div>;
  if (!rows) return <p className="muted center">Loading restaurants…</p>;
  return (
    <div className="card">
      <h3>Restaurants ({rows.length})</h3>
      <p className="sub">Every restaurant on the platform. Suspend removes their public storefront entirely.</p>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr><th>Restaurant</th><th>Storefront</th><th>Items</th><th>Orders</th><th>Revenue</th><th>Store</th><th>Suspended</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={r.suspended ? { opacity: 0.55 } : undefined}>
                <td>
                  <strong>{r.name}</strong>
                  <div className="muted" style={{ fontSize: 11 }}>{r.cuisine}</div>
                </td>
                <td>{r.slug ? <a href={`${STOREFRONT_URL}/${r.slug}`} target="_blank" rel="noreferrer">/{r.slug}</a> : <span className="muted">—</span>}</td>
                <td className="stat">{r.menuItems}</td>
                <td className="stat">{r.orders}</td>
                <td className="stat">₹{Math.round(r.revenue).toLocaleString('en-IN')}</td>
                <td>
                  <div className="flex">
                    <button className={`switch ${r.storeOpen ? 'on' : ''}`} disabled={busy === r.id} onClick={() => patch(r.id, { storeOpen: !r.storeOpen })} aria-label="Toggle store open" />
                    <span className={`pill ${r.storeOpen ? 'live' : 'off'}`}>{r.storeOpen ? 'OPEN' : 'CLOSED'}</span>
                  </div>
                </td>
                <td>
                  <div className="flex">
                    <button className={`switch ${r.suspended ? 'on' : ''}`} style={r.suspended ? { background: 'var(--red)' } : undefined} disabled={busy === r.id} onClick={() => patch(r.id, { suspended: !r.suspended })} aria-label="Toggle suspended" />
                    {r.suspended && <span className="pill susp">SUSPENDED</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Feature flags ----------
const FLAG_META: Array<{ key: keyof Flags; label: string; desc: string }> = [
  { key: 'ordering', label: 'Online ordering', desc: 'Cart, checkout & orders on every storefront' },
  { key: 'reservations', label: 'Reservations', desc: 'Table booking on every storefront' },
  { key: 'dineIn', label: 'Dine-in', desc: 'QR dine-in ordering across the platform' },
  { key: 'campaigns', label: 'Campaigns', desc: 'WhatsApp nudges & discount campaigns in dashboards' },
  { key: 'contentEngine', label: 'Content engine', desc: 'AI social-media content generation' },
  { key: 'intelligence', label: 'Intelligence', desc: 'Restaurant intelligence & competitor tracking' },
];

function FeatureFlags() {
  const [flags, setFlags] = useState<Flags | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<{ data: Flags }>('GET', '/super/flags').then((r) => setFlags(r.data)).catch((e) => setErr(e.message));
  }, []);

  const toggle = async (key: keyof Flags) => {
    if (!flags) return;
    const next = { ...flags, [key]: !flags[key] };
    setFlags(next);
    try {
      const r = await api<{ data: Flags }>('PUT', '/super/flags', next);
      setFlags(r.data);
      setSaved(true); setTimeout(() => setSaved(false), 1200);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  if (err) return <div className="msg err">{err}</div>;
  if (!flags) return <p className="muted center">Loading flags…</p>;
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <p className="muted" style={{ margin: 0 }}>Master switches — apply to <strong>all</strong> restaurants instantly (≤30s cache).</p>
        {saved && <span className="pill live">Saved ✓</span>}
      </div>
      <div className="grid">
        {FLAG_META.map(({ key, label, desc }) => (
          <div className="card" key={key}>
            <div className="row">
              <div>
                <h3>{label}</h3>
                <p className="sub" style={{ margin: 0 }}>{desc}</p>
              </div>
              <div className="flex">
                <span className={`pill ${flags[key] ? 'live' : 'off'}`}>{flags[key] ? 'LIVE' : 'OFF'}</span>
                <button className={`switch ${flags[key] ? 'on' : ''}`} onClick={() => toggle(key)} aria-label={`Toggle ${label}`} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------- Landing page ----------
function Landing() {
  const [settings, setSettings] = useState<LandingSettings | null>(null);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ data: { settings: LandingSettings; plans: Plan[] } }>('GET', '/super/landing/content')
      .then((r) => { setSettings(r.data.settings); setPlans(r.data.plans); })
      .catch((e) => setErr(e.message));
  }, []);

  const flash = (m: string) => { setOk(m); setTimeout(() => setOk(null), 2000); };

  const saveSettings = async () => {
    if (!settings) return;
    setBusy(true); setErr(null);
    try {
      await api('PUT', '/super/landing/settings', settings);
      flash('Settings saved — live on the landing page.');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const savePlans = async () => {
    if (!plans) return;
    setBusy(true); setErr(null);
    try {
      await api('PUT', '/super/landing/plans', { plans });
      flash('Plans saved — live on the landing page.');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const setPlan = (i: number, patch: Partial<Plan>) =>
    setPlans((prev) => prev?.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) ?? prev);

  if (err && !settings) return <div className="msg err">{err}</div>;
  if (!settings || !plans) return <p className="muted center">Loading landing content…</p>;

  return (
    <>
      {err && <div className="msg err">{err}</div>}
      {ok && <div className="msg ok">{ok}</div>}
      <div className="card">
        <div className="row">
          <div>
            <h3>Landing page</h3>
            <p className="sub" style={{ margin: 0 }}>Content served from MongoDB — changes appear on <a href={LANDING_URL} target="_blank" rel="noreferrer">{LANDING_URL.replace('https://', '')}</a> without a redeploy.</p>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Settings</h3>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          <div>
            <label>Currency symbol</label>
            <input value={settings.currencySymbol} onChange={(e) => setSettings({ ...settings, currencySymbol: e.target.value })} />
          </div>
          <div>
            <label>Demo / dashboard URL</label>
            <input value={settings.adminDemoUrl} onChange={(e) => setSettings({ ...settings, adminDemoUrl: e.target.value })} />
          </div>
          <div>
            <label>Months charged on yearly plan</label>
            <input type="number" min={1} max={12} value={settings.yearlyMonthsCharged} onChange={(e) => setSettings({ ...settings, yearlyMonthsCharged: Number(e.target.value) })} />
          </div>
        </div>
        <button className="btn mt" onClick={saveSettings} disabled={busy}>Save settings</button>
      </div>

      <div className="row" style={{ margin: '18px 0 10px' }}>
        <h3 style={{ margin: 0 }}>Pricing plans</h3>
        <button className="btn" onClick={savePlans} disabled={busy}>{busy ? 'Saving…' : 'Save all plans'}</button>
      </div>
      <div className="grid">
        {plans.map((p, i) => (
          <div className="card" key={p.id}>
            <div className="row">
              <h3>{p.name || p.id}</h3>
              <div className="flex">
                <label style={{ margin: 0 }}>Active</label>
                <button className={`switch ${p.active ? 'on' : ''}`} onClick={() => setPlan(i, { active: !p.active })} aria-label="Toggle active" />
              </div>
            </div>
            <label>Name</label>
            <input value={p.name} onChange={(e) => setPlan(i, { name: e.target.value })} />
            <label>Tagline</label>
            <input value={p.tagline} onChange={(e) => setPlan(i, { tagline: e.target.value })} />
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div>
                <label>Monthly price (₹)</label>
                <input type="number" min={0} value={p.monthlyPrice} onChange={(e) => setPlan(i, { monthlyPrice: Number(e.target.value) })} />
              </div>
              <div>
                <label>Badge (optional)</label>
                <input value={p.badge ?? ''} onChange={(e) => setPlan(i, { badge: e.target.value })} placeholder="Most popular" />
              </div>
            </div>
            <div className="flex mt">
              <label style={{ margin: 0 }}>Featured</label>
              <button className={`switch ${p.featured ? 'on' : ''}`} onClick={() => setPlan(i, { featured: !p.featured })} aria-label="Toggle featured" />
            </div>
            <label>Features (one per line)</label>
            <textarea
              className="plan-features"
              value={p.features.join('\n')}
              onChange={(e) => setPlan(i, { features: e.target.value.split('\n') })}
            />
          </div>
        ))}
      </div>
    </>
  );
}

// ---------- Shell ----------
type Tab = 'restaurants' | 'flags' | 'landing';

export default function App() {
  const [authed, setAuthed] = useState(!!localStorage.getItem(TOKEN_KEY));
  const [tab, setTab] = useState<Tab>('restaurants');

  if (!authed) return <div className="shell"><Login onLogin={() => setAuthed(true)} /></div>;

  return (
    <div className="shell">
      <div className="header">
        <div className="brand">
          <div className="logo">R</div>
          <div>
            <h1>RestroPulse <span style={{ color: 'var(--accent2)' }}>Super Admin</span></h1>
            <small>Platform control — <a href={ADMIN_URL} target="_blank" rel="noreferrer">merchant dashboard</a> · <a href={LANDING_URL} target="_blank" rel="noreferrer">landing page</a></small>
          </div>
        </div>
        <button className="btn ghost" onClick={() => { localStorage.removeItem(TOKEN_KEY); setAuthed(false); }}>Sign out</button>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'restaurants' ? 'active' : ''}`} onClick={() => setTab('restaurants')}>Restaurants</button>
        <button className={`tab ${tab === 'flags' ? 'active' : ''}`} onClick={() => setTab('flags')}>Feature flags</button>
        <button className={`tab ${tab === 'landing' ? 'active' : ''}`} onClick={() => setTab('landing')}>Landing page</button>
      </div>

      {tab === 'restaurants' && <Restaurants />}
      {tab === 'flags' && <FeatureFlags />}
      {tab === 'landing' && <Landing />}
    </div>
  );
}
