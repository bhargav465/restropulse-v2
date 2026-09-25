import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EnvSecretsProvider } from '../src/env-provider.js';

describe('EnvSecretsProvider', () => {
  const ORIG = { ...process.env };

  beforeEach(() => { process.env.TEST_KEY = 'test-value'; });
  afterEach(() => {
    Object.keys(process.env).forEach(k => { if (!(k in ORIG)) delete process.env[k]; });
    Object.assign(process.env, ORIG);
  });

  it('returns value for present key', async () => {
    expect(await new EnvSecretsProvider().get('TEST_KEY')).toBe('test-value');
  });

  it('returns undefined for missing key', async () => {
    expect(await new EnvSecretsProvider().get('DEFINITELY_ABSENT_XYZ')).toBeUndefined();
  });

  it('getRequired throws for missing key', async () => {
    await expect(new EnvSecretsProvider().getRequired('DEFINITELY_ABSENT_XYZ')).rejects.toThrow('DEFINITELY_ABSENT_XYZ');
  });

  it('hydrate returns only present keys', async () => {
    const result = await new EnvSecretsProvider().hydrate(['TEST_KEY', 'DEFINITELY_ABSENT_XYZ']);
    expect(result).toEqual({ TEST_KEY: 'test-value' });
  });
});
