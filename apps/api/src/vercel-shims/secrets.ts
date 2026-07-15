/**
 * Replacement for '@restropulse/secrets' in the Vercel bundle
 * (esbuild alias, see scripts/build-vercel-api.mjs).
 *
 * On Vercel, secrets come from project environment variables directly
 * (SECRETS_BACKEND is unset), so the Azure Key Vault provider — and its
 * @azure/identity + @azure/keyvault-secrets dependency tree — is never
 * needed. hydrateEnvFromProvider stays a no-op for the 'env' backend,
 * matching the real package's behavior.
 */

export interface ISecretsProvider {
    getSecret(key: string): Promise<string | undefined>;
}

export const API_SECRET_KEYS: string[] = [];
export const PUBLISHER_SECRET_KEYS: string[] = [];
export const CONTENT_ENGINE_SECRET_KEYS: string[] = [];
export const DB_CLI_SECRET_KEYS: string[] = [];
export const SECRETS_MANIFEST: Record<string, unknown> = {};

export function getAppSecretKeys(_app: string): string[] {
    return [];
}

class EnvProvider implements ISecretsProvider {
    async getSecret(key: string): Promise<string | undefined> {
        return process.env[key];
    }
}

export const EnvSecretsProvider = EnvProvider;
export const CachedSecretsProvider = EnvProvider;
export const AzureKeyVaultSecretsProvider = EnvProvider;

export function createSecretsProvider(_backend?: string): ISecretsProvider {
    return new EnvProvider();
}

export async function hydrateEnvFromProvider(_provider: ISecretsProvider, _keys: string[]): Promise<void> {
    // env backend: process.env already holds the values — nothing to hydrate.
}
