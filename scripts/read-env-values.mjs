#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SHOW_SECRETS = process.argv.includes('--show-secrets');
const INCLUDE_VARIANTS = process.argv.includes('--include-env-variants');
const JSON_OUTPUT = process.argv.includes('--json');

function readJson(absPath) {
  return JSON.parse(readFileSync(absPath, 'utf8'));
}

function listWorkspaceDirs(patterns) {
  const dirs = [];
  for (const pattern of patterns) {
    // Supports patterns like "apps/*", "packages/*"
    if (!pattern.endsWith('/*')) continue;
    const base = pattern.slice(0, -2);
    const absBase = join(ROOT, base);
    if (!existsSync(absBase)) continue;
    for (const entry of readdirSync(absBase)) {
      const abs = join(absBase, entry);
      if (statSync(abs).isDirectory()) dirs.push(join(base, entry));
    }
  }
  return dirs.sort();
}

function findEnvFiles(componentRelPath) {
  const abs = join(ROOT, componentRelPath);
  if (!existsSync(abs)) return [];
  const files = readdirSync(abs).filter((n) => {
    if (INCLUDE_VARIANTS) return n === '.env' || n.startsWith('.env.');
    return n === '.env';
  });
  return files.map((f) => join(componentRelPath, f)).sort();
}

function parseEnvBody(body) {
  const entries = [];
  const lines = body.split(/\r?\n/);
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2] ?? '';
    entries.push({ key, value });
  }
  return entries;
}

function isSecretKey(key) {
  return /(SECRET|TOKEN|PASSWORD|MONGODB|URI|KEY|CONNECTION|JWT|FIREBASE|RAZORPAY|AZURE|APPINSIGHTS)/i.test(key);
}

function displayValue(key, value) {
  if (SHOW_SECRETS) return value;
  return isSecretKey(key) ? '<redacted>' : value;
}

function printEnvFile(relPath) {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) return;
  const entries = parseEnvBody(readFileSync(abs, 'utf8'));

  console.log(`\n# ${relPath}`);
  if (entries.length === 0) {
    console.log('(no env entries)');
    return;
  }

  for (const { key, value } of entries) {
    console.log(`${key}=${displayValue(key, value)}`);
  }
}

function main() {
  const pkgJson = readJson(join(ROOT, 'package.json'));
  const workspaces = Array.isArray(pkgJson.workspaces) ? pkgJson.workspaces : [];
  const components = listWorkspaceDirs(workspaces);

  const jsonFiles = [];

  // Include root .env files as well.
  const rootEnvFiles = findEnvFiles('.');
  for (const rel of rootEnvFiles) {
    if (JSON_OUTPUT) {
      const abs = join(ROOT, rel);
      const entries = parseEnvBody(readFileSync(abs, 'utf8')).map(({ key, value }) => ({
        key,
        value: displayValue(key, value),
      }));
      jsonFiles.push({ path: rel, entries });
    } else {
      printEnvFile(rel);
    }
  }

  for (const component of components) {
    const envFiles = findEnvFiles(component);
    for (const envFile of envFiles) {
      if (JSON_OUTPUT) {
        const abs = join(ROOT, envFile);
        const entries = parseEnvBody(readFileSync(abs, 'utf8')).map(({ key, value }) => ({
          key,
          value: displayValue(key, value),
        }));
        jsonFiles.push({ path: envFile, entries });
      } else {
        printEnvFile(envFile);
      }
    }
  }

  if (JSON_OUTPUT) {
    const payload = {
      root: ROOT,
      includeEnvVariants: INCLUDE_VARIANTS,
      redacted: !SHOW_SECRETS,
      files: jsonFiles,
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (!SHOW_SECRETS) {
    console.log('\nNote: secret-like keys are redacted. Use --show-secrets to print raw values.');
  }
}

main();
