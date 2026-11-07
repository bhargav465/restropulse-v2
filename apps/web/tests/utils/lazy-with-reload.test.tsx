import { describe, it, expect, vi } from 'vitest';
import { Suspense } from 'react';
import { render, screen } from '@testing-library/react';
import { lazyWithReload, loadWithReload, CHUNK_RELOAD_FLAG } from '../../utils/lazy-with-reload';

function memoryStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    return {
        data,
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
        removeItem: (k: string) => void data.delete(k),
    };
}

describe('loadWithReload', () => {
    it('returns the module and clears a stale reload flag on success', async () => {
        const storage = memoryStorage({ [CHUNK_RELOAD_FLAG]: '1' });
        const reload = vi.fn();
        const mod = await loadWithReload(async () => ({ default: 'ok' }), { storage, reload });
        expect(mod).toEqual({ default: 'ok' });
        expect(storage.data.has(CHUNK_RELOAD_FLAG)).toBe(false);
        expect(reload).not.toHaveBeenCalled();
    });

    it('reloads once when a chunk fails to load (stale deploy) and never settles', async () => {
        const storage = memoryStorage();
        const reload = vi.fn();
        let settled = false;
        void loadWithReload(() => Promise.reject(new Error('Failed to fetch dynamically imported module')), { storage, reload })
            .then(() => { settled = true; }, () => { settled = true; });
        await new Promise((r) => setTimeout(r, 0));
        expect(reload).toHaveBeenCalledTimes(1);
        expect(storage.data.get(CHUNK_RELOAD_FLAG)).toBe('1');
        expect(settled).toBe(false);
    });

    it('rethrows instead of looping when it already reloaded once', async () => {
        const storage = memoryStorage({ [CHUNK_RELOAD_FLAG]: '1' });
        const reload = vi.fn();
        await expect(loadWithReload(() => Promise.reject(new Error('offline')), { storage, reload })).rejects.toThrow('offline');
        expect(reload).not.toHaveBeenCalled();
    });
});

describe('lazyWithReload', () => {
    it('renders the lazily loaded component inside Suspense', async () => {
        const View = lazyWithReload(async () => ({ default: () => <p>lazy view</p> }), { storage: memoryStorage(), reload: vi.fn() });
        render(<Suspense fallback={<p>loading</p>}><View /></Suspense>);
        expect(screen.getByText('loading')).toBeInTheDocument();
        expect(await screen.findByText('lazy view')).toBeInTheDocument();
    });
});
