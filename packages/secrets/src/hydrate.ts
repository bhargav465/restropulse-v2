import type { ISecretsProvider } from './types.js';

export async function hydrateEnvFromProvider(
  provider: ISecretsProvider,
  keys: string[],
): Promise<void> {
  const resolved = await provider.hydrate(keys);
  for (const [key, value] of Object.entries(resolved)) {
    process.env[key] = value;
  }
}
