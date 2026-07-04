#!/usr/bin/env node
/**
 * Cross-platform runner for integration tests.
 *
 * Usage:
 *   node scripts/test-integration.mjs              # local .env files
 *   node scripts/test-integration.mjs kv:dev       # Azure KV, dev prefix
 *   node scripts/test-integration.mjs kv:staging   # Azure KV, staging prefix
 *   node scripts/test-integration.mjs kv:prod      # Azure KV, prod prefix
 *
 * The KV variants require:
 *   - az login (or a managed identity in CI)
 *   - AZURE_KEY_VAULT_URL set in any app .env file or already in process.env
 */

import { execSync } from 'node:child_process';

const mode = process.argv[2] ?? 'local';

const KV_URL = process.env.AZURE_KEY_VAULT_URL ?? '';

const modes = {
  local:       {},
  'kv:dev':     { SECRETS_BACKEND: 'azure-kv', AZURE_KEY_VAULT_KEY_PREFIX: 'dev',     AZURE_KEY_VAULT_URL: KV_URL },
  'kv:staging': { SECRETS_BACKEND: 'azure-kv', AZURE_KEY_VAULT_KEY_PREFIX: 'staging', AZURE_KEY_VAULT_URL: KV_URL },
  'kv:prod':    { SECRETS_BACKEND: 'azure-kv', AZURE_KEY_VAULT_KEY_PREFIX: 'prod',     AZURE_KEY_VAULT_URL: KV_URL },
};

if (!modes[mode]) {
  console.error(`Unknown mode: "${mode}"\nValid modes: ${Object.keys(modes).join(', ')}`);
  process.exit(1);
}

const suite = process.argv[3]; // optional: path to a single suite file
const cmd = suite
  ? `npx vitest run --config tests/integration/vitest.config.ts ${suite}`
  : 'npx vitest run --config tests/integration/vitest.config.ts';

console.log(`[integration] mode=${mode}${suite ? ` suite=${suite}` : ''}`);

execSync(cmd, {
  stdio: 'inherit',
  env: { ...process.env, ...modes[mode] },
});
