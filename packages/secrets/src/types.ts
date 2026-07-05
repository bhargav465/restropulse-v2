export interface ISecretsProvider {
  get(key: string): Promise<string | undefined>;
  getRequired(key: string): Promise<string>;
  hydrate(keys: string[]): Promise<Record<string, string>>;
}
