import { describe, it, expect, vi } from 'vitest';
import { CachedSecretsProvider } from '../src/cached-provider.js';
import type { ISecretsProvider } from '../src/types.js';

function makeDelegate(values: Record<string, string>): ISecretsProvider {
  return {
    get: vi.fn(async (k: string) => values[k]),
    getRequired: vi.fn(async (k: string) => { const v = values[k]; if (!v) throw new Error(`missing ${k}`); return v; }),
    hydrate: vi.fn(async (keys: string[]) => Object.fromEntries(keys.filter(k => values[k]).map(k => [k, values[k]]))),
  };
}

describe('CachedSecretsProvider', () => {
  it('returns value from delegate on first call', async () => {
    const d = makeDelegate({ FOO: 'bar' });
    expect(await new CachedSecretsProvider(d).get('FOO')).toBe('bar');
    expect(d.get).toHaveBeenCalledOnce();
  });

  it('serves second call from cache without re-calling delegate', async () => {
    const d = makeDelegate({ FOO: 'bar' });
    const c = new CachedSecretsProvider(d);
    await c.get('FOO');
    await c.get('FOO');
    expect(d.get).toHaveBeenCalledOnce();
  });

  it('hydrate populates cache so subsequent get calls skip delegate', async () => {
    const d = makeDelegate({ A: '1', B: '2' });
    const c = new CachedSecretsProvider(d);
    await c.hydrate(['A', 'B']);
    await c.get('A');
    await c.get('B');
    expect(d.get).not.toHaveBeenCalled();
  });
});
