import { describe, it, expect, vi } from 'vitest';
vi.mock('@azure/keyvault-secrets', () => ({ SecretClient: vi.fn() }));
vi.mock('@azure/identity', () => ({ DefaultAzureCredential: vi.fn() }));

const { createSecretsProvider, EnvSecretsProvider, CachedSecretsProvider } = await import('../src/index.js');

describe('createSecretsProvider', () => {
  it('returns EnvSecretsProvider when backend undefined', () => {
    expect(createSecretsProvider(undefined)).toBeInstanceOf(EnvSecretsProvider);
  });

  it('returns EnvSecretsProvider when backend is "env"', () => {
    expect(createSecretsProvider('env')).toBeInstanceOf(EnvSecretsProvider);
  });

  it('returns CachedSecretsProvider for azure-kv', () => {
    process.env.AZURE_KEY_VAULT_URL = 'https://test.vault.azure.net';
    expect(createSecretsProvider('azure-kv')).toBeInstanceOf(CachedSecretsProvider);
    delete process.env.AZURE_KEY_VAULT_URL;
  });

  it('throws when azure-kv selected without AZURE_KEY_VAULT_URL', () => {
    delete process.env.AZURE_KEY_VAULT_URL;
    expect(() => createSecretsProvider('azure-kv')).toThrow('AZURE_KEY_VAULT_URL');
  });
});
