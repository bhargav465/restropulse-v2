import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { PublicCustomer } from '@restropulse/shared';
import { customerAuthAPI, getStoredCustomer, getToken } from '../api';
import { useStorefront } from './StorefrontContext';

interface AuthContextValue {
  customer: PublicCustomer | null;
  isLoggedIn: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; password: string; name?: string; phone?: string }) => Promise<void>;
  logout: () => void;
  refreshCustomer: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { slug } = useStorefront();
  const [customer, setCustomer] = useState<PublicCustomer | null>(() =>
    getToken(slug) ? getStoredCustomer(slug) : null,
  );

  // Validate persisted token on mount / slug change
  useEffect(() => {
    let cancelled = false;
    if (getToken(slug)) {
      customerAuthAPI
        .me(slug)
        .then((c) => { if (!cancelled) setCustomer(c); })
        .catch(() => { if (!cancelled) setCustomer(null); });
    } else {
      setCustomer(null);
    }
    return () => { cancelled = true; };
  }, [slug]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await customerAuthAPI.login(slug, email, password);
    setCustomer(result.customer);
  }, [slug]);

  const register = useCallback(async (data: { email: string; password: string; name?: string; phone?: string }) => {
    const result = await customerAuthAPI.register(slug, data);
    setCustomer(result.customer);
  }, [slug]);

  const logout = useCallback(() => {
    customerAuthAPI.logout(slug);
    setCustomer(null);
  }, [slug]);

  const refreshCustomer = useCallback(async () => {
    try {
      setCustomer(await customerAuthAPI.me(slug));
    } catch {
      /* keep current state */
    }
  }, [slug]);

  return (
    <AuthContext.Provider value={{ customer, isLoggedIn: customer !== null, login, register, logout, refreshCustomer }}>
      {children}
    </AuthContext.Provider>
  );
};
