import React, { useEffect, useState } from 'react';
import { useAuth } from '../store/AuthContext';
import { useStorefront } from '../store/StorefrontContext';
import { track } from '../lib/analytics';

/**
 * Login / register form against the storefront customer auth endpoints.
 * Fires a `login_prompt` analytics event when shown.
 */
const AuthForms: React.FC<{ intent?: string }> = ({ intent }) => {
  const { slug } = useStorefront();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    track(slug, 'login_prompt', intent ? { intent } : undefined);
  }, [slug, intent]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register({
          email,
          password,
          ...(name.trim() ? { name: name.trim() } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 max-w-md mx-auto">
      <div className="flex rounded-xl bg-slate-100 p-1 mb-4" role="tablist" aria-label="Sign in or create account">
        <button
          role="tab"
          aria-selected={mode === 'login'}
          onClick={() => setMode('login')}
          className={`flex-1 py-2 rounded-lg text-sm font-bold ${mode === 'login' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
        >
          Sign in
        </button>
        <button
          role="tab"
          aria-selected={mode === 'register'}
          onClick={() => setMode('register')}
          className={`flex-1 py-2 rounded-lg text-sm font-bold ${mode === 'register' ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}
        >
          Create account
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {mode === 'register' && (
          <>
            <div>
              <label htmlFor="auth-name" className="block text-xs font-bold text-slate-600 mb-1">Name</label>
              <input
                id="auth-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sf-primary)]"
              />
            </div>
            <div>
              <label htmlFor="auth-phone" className="block text-xs font-bold text-slate-600 mb-1">Phone</label>
              <input
                id="auth-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sf-primary)]"
              />
            </div>
          </>
        )}
        <div>
          <label htmlFor="auth-email" className="block text-xs font-bold text-slate-600 mb-1">Email</label>
          <input
            id="auth-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sf-primary)]"
          />
        </div>
        <div>
          <label htmlFor="auth-password" className="block text-xs font-bold text-slate-600 mb-1">
            Password {mode === 'register' && <span className="font-normal text-slate-400">(min 8 characters)</span>}
          </label>
          <input
            id="auth-password"
            type="password"
            required
            minLength={mode === 'register' ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sf-primary)]"
          />
        </div>

        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full py-3 rounded-xl bg-[var(--sf-primary)] text-white font-bold text-sm hover:opacity-90 disabled:opacity-60"
        >
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>
    </div>
  );
};

export default AuthForms;
