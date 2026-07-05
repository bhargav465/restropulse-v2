import type { ISecretsProvider } from './types.js';

export class CachedSecretsProvider implements ISecretsProvider {
  private readonly cache = new Map<string, string>();
  private readonly delegate: ISecretsProvider;

  constructor(delegate: ISecretsProvider) {
    this.delegate = delegate;
  }

  async get(key: string): Promise<string | undefined> {
    if (this.cache.has(key)) return this.cache.get(key);
    const v = await this.delegate.get(key);
    if (v !== undefined) this.cache.set(key, v);
    return v;
  }

  async getRequired(key: string): Promise<string> {
    const v = await this.get(key);
    if (v === undefined) throw new Error(`Required secret ${key} not found`);
    return v;
  }

  async hydrate(keys: string[]): Promise<Record<string, string>> {
    const uncached = keys.filter(k => !this.cache.has(k));
    if (uncached.length > 0) {
      const fresh = await this.delegate.hydrate(uncached);
      for (const [k, v] of Object.entries(fresh)) this.cache.set(k, v);
    }
    return Object.fromEntries(
      keys.filter(k => this.cache.has(k)).map(k => [k, this.cache.get(k)!]),
    );
  }
}
