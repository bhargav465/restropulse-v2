#!/usr/bin/env node

/**
 * Pull "dev-*" secrets from Azure Key Vault and hydrate each app's local .env file.
 *
 * Unlike AzureKeyVaultSecretsProvider (which derives the KV secret name from the
 * env key), this script resolves the KV secret name from the manifest's `kvName`
 * field. This is required for web (VITE_*) keys, whose KV names do not match the
 * kebab-cased env key.
 *
 * Usage:
 *   node scripts/secrets-pull.mjs                    # pull for all apps
 *   node scripts/secrets-pull.mjs --app web           # pull for a single app
 *   node scripts/secrets-pull.mjs --app root          # pull root tooling env (ngrok)
 *   node scripts/secrets-pull.mjs --dry-run           # print mapping, no network/writes
 *   node scripts/secrets-pull.mjs --dry-run --app api
 *
 * Available via: npm run secrets:pull
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SECRETS_MANIFEST } from '@restropulse/secrets';

const REPO_ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1').replace(/\/$/, '');

const KEY_VAULT_URL = process.env.AZURE_KEY_VAULT_URL || 'https://restropulse-prod-kv.vault.azure.net';
const PREFIX = 'dev';

const ALL_APPS = ['api', 'web', 'publisher', 'content-engine', 'intelligence-worker', 'db-cli', 'root'];
const RUNTIME_AKV_APPS = ['api', 'publisher', 'content-engine', 'intelligence-worker', 'db-cli'];
const WEB_LOCAL_DEFAULTS = {
  VITE_API_URL: 'http://localhost:3001/api',
  VITE_APP_URL: 'http://localhost:3000',
};
const API_LOCAL_DEFAULTS = {
  FRONTEND_URL: 'http://localhost:3000',
  BACKEND_URL: 'http://localhost:3001',
};
const AKV_RUNTIME_DEFAULTS = {
  SECRETS_BACKEND: 'azure-kv',
  AZURE_KEY_VAULT_URL: KEY_VAULT_URL,
  AZURE_KEY_VAULT_KEY_PREFIX: PREFIX,
};
const ROOT_SECRET_MAPPINGS = [
  { key: 'NGROK_AUTH_TOKEN', kvName: 'ngrok-auth-token' },
  { key: 'NGROK_DOMAIN', kvName: 'ngrok-domain' },
];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const appIndex = args.indexOf('--app');
const requestedApp = appIndex !== -1 ? args[appIndex + 1] : undefined;

if (requestedApp && !ALL_APPS.includes(requestedApp)) {
  console.error(`Unknown app "${requestedApp}". Expected one of: ${ALL_APPS.join(', ')}`);
  process.exit(1);
}

const apps = requestedApp ? [requestedApp] : ALL_APPS;

function envPathForApp(app) {
  if (app === 'root') {
    return join(REPO_ROOT, '.env');
  }
  return join(REPO_ROOT, 'apps', app, '.env');
}

function selectSecretsForApp(app) {
  if (app === 'root') {
    return ROOT_SECRET_MAPPINGS;
  }
  return SECRETS_MANIFEST.filter((def) => def.apps.includes(app));
}

function mergeEnvFile(envPath, resolved, removeKeys = []) {
  let lines = [];
  if (existsSync(envPath)) {
    lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  }

  if (removeKeys.length > 0) {
    const keySet = new Set(removeKeys);
    lines = lines.filter((line) => {
      const eq = line.indexOf('=');
      if (eq === -1) return true;
      const key = line.slice(0, eq).trim();
      return !keySet.has(key);
    });
  }

  for (const [key, value] of Object.entries(resolved)) {
    const lineIndex = lines.findIndex((line) => line.startsWith(`${key}=`));
    const newLine = `${key}=${value}`;
    if (lineIndex !== -1) {
      lines[lineIndex] = newLine;
    } else {
      lines.push(newLine);
    }
  }

  // Drop trailing blank lines, then ensure a single trailing newline.
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  writeFileSync(envPath, lines.join('\n') + '\n', 'utf8');
}

async function pullForApp(app, client) {
  const defs = selectSecretsForApp(app);
  const envPath = envPathForApp(app);
  const runtimeAkv = RUNTIME_AKV_APPS.includes(app);

  let resolvedCount = 0;
  let skippedCount = 0;
  const resolved = {};

  if (!runtimeAkv) {
    for (const def of defs) {
      if (!def.kvName) {
        skippedCount++;
        continue;
      }
      const kvSecretName = `${PREFIX}-${def.kvName}`;

      if (dryRun) {
        console.log(`${app}: ${def.key} -> ${kvSecretName}`);
        continue;
      }

      try {
        const secret = await client.getSecret(kvSecretName);
        if (secret?.value !== undefined) {
          resolved[def.key] = secret.value;
          resolvedCount++;
        } else {
          skippedCount++;
        }
      } catch (err) {
        if (err?.code === 'SecretNotFound' || err?.statusCode === 404) {
          skippedCount++;
        } else {
          throw err;
        }
      }
    }
  } else {
    for (const def of defs) {
      if (def.kvName) {
        skippedCount++;
      }
    }
    Object.assign(resolved, AKV_RUNTIME_DEFAULTS);
  }

  if (dryRun) {
    return;
  }

  if (app === 'web') {
    for (const [key, value] of Object.entries(WEB_LOCAL_DEFAULTS)) {
      if (!resolved[key]) {
        resolved[key] = value;
      }
    }
  }
  if (app === 'api') {
    for (const [key, value] of Object.entries(API_LOCAL_DEFAULTS)) {
      if (!resolved[key]) {
        resolved[key] = value;
      }
    }
  }

  if (Object.keys(resolved).length > 0) {
    const removeKeys = runtimeAkv
      ? defs.filter((d) => d.kvName).map((d) => d.key)
      : [];
    mergeEnvFile(envPath, resolved, removeKeys);
  }

  console.log(`${app}: resolved=${resolvedCount} skipped-missing=${skippedCount} -> ${envPath}`);
}

async function main() {
  let client;

  if (!dryRun) {
    const { SecretClient } = await import('@azure/keyvault-secrets');
    const { DefaultAzureCredential } = await import('@azure/identity');
    client = new SecretClient(KEY_VAULT_URL, new DefaultAzureCredential());
  }

  for (const app of apps) {
    await pullForApp(app, client);
  }
}

main().catch((err) => {
  console.error(`secrets:pull failed: ${err.message}`);
  process.exit(1);
});
