import { EnvSecretsProvider } from './env-provider.js';
import { AzureKeyVaultSecretsProvider } from './azure-kv-provider.js';
import { CachedSecretsProvider } from './cached-provider.js';
import type { ISecretsProvider } from './types.js';

export type SecretsBackend = 'env' | 'azure-kv';

export interface AzureKvOptions {
  vaultUrl: string;
  keyPrefix?: string;
}

export function createSecretsProvider(
  backend: string | undefined,
  options?: { azureKv?: AzureKvOptions },
): ISecretsProvider {
  if (backend === 'azure-kv') {
    const vaultUrl = options?.azureKv?.vaultUrl ?? process.env.AZURE_KEY_VAULT_URL;
    if (!vaultUrl) {
      throw new Error('SECRETS_BACKEND=azure-kv requires AZURE_KEY_VAULT_URL to be set');
    }
    const keyPrefix = options?.azureKv?.keyPrefix ?? process.env.AZURE_KEY_VAULT_KEY_PREFIX;
    return new CachedSecretsProvider(
      new AzureKeyVaultSecretsProvider({ vaultUrl, keyPrefix }),
    );
  }
  return new EnvSecretsProvider();
}
