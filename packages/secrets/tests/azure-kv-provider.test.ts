import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@azure/keyvault-secrets', () => ({
  SecretClient: vi.fn().mockImplementation(() => ({
    getSecret: vi.fn().mockImplementation(async (name: string) => {
      const store: Record<string, string> = {
        'mongodb-uri': 'mongodb+srv://test',
        'anthropic-api-key': 'sk-ant-test',
      };
      if (!store[name]) { const e = new Error('SecretNotFound') as any; e.code = 'SecretNotFound'; throw e; }
      return { value: store[name] };
    }),
  })),
}));
vi.mock('@azure/identity', () => ({ DefaultAzureCredential: vi.fn() }));

const { AzureKeyVaultSecretsProvider } = await import('../src/azure-kv-provider.js');
beforeEach(() => vi.clearAllMocks());

describe('AzureKeyVaultSecretsProvider', () => {
  it('maps UPPER_SNAKE env key to kebab-case KV name', async () => {
    const p = new AzureKeyVaultSecretsProvider({ vaultUrl: 'https://test.vault.azure.net' });
    expect(await p.get('ANTHROPIC_API_KEY')).toBe('sk-ant-test');
  });

  it('returns undefined for SecretNotFound', async () => {
    const p = new AzureKeyVaultSecretsProvider({ vaultUrl: 'https://test.vault.azure.net' });
    expect(await p.get('NONEXISTENT_KEY')).toBeUndefined();
  });

  it('getRequired throws when secret does not exist', async () => {
    const p = new AzureKeyVaultSecretsProvider({ vaultUrl: 'https://test.vault.azure.net' });
    await expect(p.getRequired('NONEXISTENT_KEY')).rejects.toThrow('NONEXISTENT_KEY');
  });

  it('hydrate fetches all in parallel, returns only found ones', async () => {
    const p = new AzureKeyVaultSecretsProvider({ vaultUrl: 'https://test.vault.azure.net' });
    const result = await p.hydrate(['MONGODB_URI', 'ANTHROPIC_API_KEY', 'NONEXISTENT_KEY']);
    expect(result).toEqual({ MONGODB_URI: 'mongodb+srv://test', ANTHROPIC_API_KEY: 'sk-ant-test' });
  });

  it('prepends keyPrefix when provided', async () => {
    const p = new AzureKeyVaultSecretsProvider({ vaultUrl: 'https://test.vault.azure.net', keyPrefix: 'dev' });
    // 'dev-anthropic-api-key' not in mock store
    expect(await p.get('ANTHROPIC_API_KEY')).toBeUndefined();
  });
});
