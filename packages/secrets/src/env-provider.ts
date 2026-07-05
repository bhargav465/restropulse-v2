import type { ISecretsProvider } from './types.js';

export class EnvSecretsProvider implements ISecretsProvider {
  async get(key: string): Promise<string | undefined> {
    const v = process.env[key];
    return v === '' ? undefined : v;
  }

  async getRequired(key: string): Promise<string> {
    const v = await this.get(key);
    if (v === undefined) throw new Error(`Required secret ${key} not found in process.env`);
    return v;
  }

  async hydrate(keys: string[]): Promise<Record<string, string>> {
    const entries = await Promise.all(
      keys.map(async (k) => [k, await this.get(k)] as const),
    );
    return Object.fromEntries(entries.filter(([, v]) => v !== undefined) as [string, string][]);
  }
}
