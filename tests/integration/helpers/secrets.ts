import { config } from 'dotenv';
import { resolve } from 'path';

const ROOT = resolve(process.cwd());

// Priority order (highest first, override: false means earlier values win):
// 1. process.env — CI secrets injected by the workflow, or SECRETS_BACKEND=azure-kv hydration below
// 2. tests/integration/.env.integration — optional local overrides
// 3. apps/content-engine/.env — AI backend keys
// 4. apps/api/.env             — auth, payments, Meta keys
// 5. apps/publisher/.env       — encryption, Instagram keys
config({ path: resolve(ROOT, 'tests/integration/.env.integration'), override: false });
config({ path: resolve(ROOT, 'apps/content-engine/.env'), override: false });
config({ path: resolve(ROOT, 'apps/api/.env'), override: false });
config({ path: resolve(ROOT, 'apps/publisher/.env'), override: false });

// When SECRETS_BACKEND=azure-kv, fetch all secrets from Key Vault and write into
// process.env. Runs once at module load (top-level await). The KV prefix
// (AZURE_KEY_VAULT_KEY_PREFIX) determines which environment's values are used —
// 'dev', 'staging', or 'prod'. Individual suites call requireSecrets() unchanged.
if (process.env.SECRETS_BACKEND === 'azure-kv') {
  const { createSecretsProvider, hydrateEnvFromProvider, SECRETS_MANIFEST } = await import('@restropulse/secrets');
  const allKeys = SECRETS_MANIFEST.filter(s => !s.buildTime).map(s => s.key);
  await hydrateEnvFromProvider(createSecretsProvider('azure-kv'), allKeys);
}

/**
 * Returns the secrets map or throws if any required key is absent.
 * Use for suites that must run whenever tests are triggered — missing secrets
 * indicate a configuration problem that should be fixed, not silently hidden.
 */
export function requireSecrets<K extends string>(
  suiteName: string,
  keys: K[],
): Record<K, string> {
  const missing = keys.filter(k => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `[integration] Suite "${suiteName}" is missing required secrets: ${missing.join(', ')}.\n` +
      `Set them in the relevant apps/*.env file, tests/integration/.env.integration, or as CI environment variables.\n` +
      `See tests/integration/.env.integration.example for the full list.`,
    );
  }
  return Object.fromEntries(keys.map(k => [k, process.env[k]!])) as Record<K, string>;
}

/**
 * Returns the secrets map if all keys are present, or null if any are missing.
 * Use with describe.skipIf(secrets === null) for suites that require credentials
 * that cannot be provisioned like a normal API key — e.g. a live OAuth token
 * from a connected third-party account (Instagram, etc.).
 */
export function optionalSecrets<K extends string>(
  keys: K[],
): Record<K, string> | null {
  const missing = keys.filter(k => !process.env[k]);
  if (missing.length > 0) return null;
  return Object.fromEntries(keys.map(k => [k, process.env[k]!])) as Record<K, string>;
}
