import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * React.lazy with one automatic page reload when a chunk fails to load.
 *
 * Each deploy replaces the hashed chunk files on Static Web Apps. A tab opened
 * before the deploy still holds the old index.js, so navigating to a lazy view
 * asks for a chunk name that no longer exists and the import rejects. Reloading
 * once fetches the new index.js and its new chunk names. The sessionStorage
 * flag stops a reload loop when the failure is something else (offline, a real
 * 404); in that case the error is rethrown for the nearest ErrorBoundary.
 */
export const CHUNK_RELOAD_FLAG = 'rp_chunk_reload';

export function lazyWithReload<T extends ComponentType<any>>(
    factory: () => Promise<{ default: T }>,
    deps: { storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; reload?: () => void } = {},
): LazyExoticComponent<T> {
    return lazy(() => loadWithReload(factory, deps));
}

export async function loadWithReload<T>(
    factory: () => Promise<T>,
    deps: { storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; reload?: () => void } = {},
): Promise<T> {
    const storage = deps.storage ?? safeSessionStorage();
    const reload = deps.reload ?? (() => window.location.reload());
    try {
        const mod = await factory();
        storage?.removeItem(CHUNK_RELOAD_FLAG);
        return mod;
    } catch (err) {
        if (storage && !storage.getItem(CHUNK_RELOAD_FLAG)) {
            storage.setItem(CHUNK_RELOAD_FLAG, '1');
            reload();
            // Keep Suspense showing its fallback while the page reloads.
            return new Promise<T>(() => undefined);
        }
        throw err;
    }
}

function safeSessionStorage(): Storage | undefined {
    try {
        return typeof window !== 'undefined' ? window.sessionStorage : undefined;
    } catch {
        return undefined;
    }
}
