import { describe, it, expect } from 'vitest';
import { SECRETS_MANIFEST, getAppSecretKeys } from '../src/manifest.js';

describe('SECRETS_MANIFEST', () => {
  it('resolves VITE_FIREBASE_API_KEY to kvName firebase-api-key', () => {
    const def = SECRETS_MANIFEST.find((s) => s.key === 'VITE_FIREBASE_API_KEY');
    expect(def).toBeDefined();
    expect(def?.kvName).toBe('firebase-api-key');
  });

  it('excludes buildTime keys from getAppSecretKeys but keeps web entries in the manifest', () => {
    expect(getAppSecretKeys('web')).toEqual([]);
    const webEntries = SECRETS_MANIFEST.filter((s) => s.apps.includes('web'));
    expect(webEntries.length).toBeGreaterThan(0);
  });

  it('includes ANTHROPIC_API_KEY for content-engine', () => {
    expect(getAppSecretKeys('content-engine')).toContain('ANTHROPIC_API_KEY');
  });
});
