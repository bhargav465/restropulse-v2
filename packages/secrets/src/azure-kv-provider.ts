import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';
import type { ISecretsProvider } from './types.js';

export interface AzureKeyVaultSecretsProviderOptions {
  vaultUrl: string;
  keyPrefix?: string;
}

export class AzureKeyVaultSecretsProvider implements ISecretsProvider {
  private readonly client: SecretClient;
  private readonly keyPrefix: string;

  constructor(options: AzureKeyVaultSecretsProviderOptions) {
    this.client = new SecretClient(options.vaultUrl, new DefaultAzureCredential());
    this.keyPrefix = options.keyPrefix ?? '';
  }

  async get(key: string): Promise<string | undefined> {
    const kvName = this.toKvName(key);
    try {
      const secret = await this.client.getSecret(kvName);
      return secret.value ?? undefined;
    } catch (err: any) {
      if (err?.code === 'SecretNotFound') return undefined;
      throw err;
    }
  }

  async getRequired(key: string): Promise<string> {
    const v = await this.get(key);
    if (v === undefined) {
      throw new Error(
        `Required secret ${key} (KV name: ${this.toKvName(key)}) not found in Key Vault`,
      );
    }
    return v;
  }

  async hydrate(keys: string[]): Promise<Record<string, string>> {
    const entries = await Promise.all(
      keys.map(async (k) => [k, await this.get(k)] as const),
    );
    return Object.fromEntries(entries.filter(([, v]) => v !== undefined) as [string, string][]);
  }

  private toKvName(envKey: string): string {
    const base = envKey.toLowerCase().replace(/_/g, '-');
    return this.keyPrefix ? `${this.keyPrefix}-${base}` : base;
  }
}
