import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { RestaurantOrderingSettings, StorefrontContent } from '@restropulse/shared';
import { storefrontAPI } from '../api';
import type { StorefrontConfig } from '../types';

interface StorefrontContextValue {
  slug: string;
  loading: boolean;
  error: string | null;
  notFound: boolean;
  config: StorefrontConfig | null;
  content: StorefrontContent | null;
  ordering: RestaurantOrderingSettings;
  storeOpen: boolean;
  currency: string;
  restaurantName: string;
  reload: () => void;
}

const StorefrontContext = createContext<StorefrontContextValue | null>(null);

export function useStorefront(): StorefrontContextValue {
  const ctx = useContext(StorefrontContext);
  if (!ctx) throw new Error('useStorefront must be used inside StorefrontProvider');
  return ctx;
}

export const StorefrontProvider: React.FC<{ slug: string; children: React.ReactNode }> = ({ slug, children }) => {
  const [config, setConfig] = useState<StorefrontConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);

    storefrontAPI
      .getConfig(slug)
      .then((cfg) => {
        if (cancelled) return;
        setConfig(cfg);
        document.title = `${cfg.restaurant.name} — Order Online`;
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const status = (err as { status?: number }).status;
        if (status === 404) setNotFound(true);
        setError(err instanceof Error ? err.message : 'Failed to load storefront');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug, reloadKey]);

  const content = config?.content ?? null;
  const theme = content?.theme;

  const value: StorefrontContextValue = {
    slug,
    loading,
    error,
    notFound,
    config,
    content,
    ordering: config?.restaurant.ordering ?? {},
    storeOpen: config?.storeOpen === true,
    currency: config?.restaurant.ordering?.currency ?? 'INR',
    restaurantName: config?.restaurant.name ?? '',
    reload,
  };

  const themeStyle = {
    ...(theme?.primaryColor ? { '--sf-primary': theme.primaryColor } : {}),
    ...(theme?.secondaryColor ? { '--sf-secondary': theme.secondaryColor } : {}),
    ...(theme?.accentColor ? { '--sf-accent': theme.accentColor } : {}),
  } as React.CSSProperties;

  return (
    <StorefrontContext.Provider value={value}>
      <div style={themeStyle} className="min-h-screen flex flex-col">
        {children}
      </div>
    </StorefrontContext.Provider>
  );
};
