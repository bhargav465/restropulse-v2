#!/usr/bin/env node
/**
 * audit-env-keys.mjs
 *
 * Scans every .env file in the workspace, extracts the KEY names (never the
 * values), and checks whether each key is still referenced anywhere in the
 * codebase (source, schemas, manifest, docs, workflows, scripts, configs).
 *
 * Keys that appear nowhere outside their own .env are flagged as candidates
 * for cleanup. Output contains key NAMES and reference counts only -- no secret
 * values are ever printed.
 *
 * Usage:
 *   node scripts/audit-env-keys.mjs            # report only (default)
 *   node scripts/audit-env-keys.mjs --clean    # back up each .env, then remove
 *                                              # the unreferenced keys
 *
 * Cleanup always writes a timestamped backup next to each edited file:
 *   apps/api/.env  ->  apps/api/.env.bak-YYYYMMDD-HHmmss
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLEAN = process.argv.includes('--clean');

// .env files to audit (relative to repo root).
const ENV_FILES = [
  '.env',
  'apps/api/.env',
  'apps/content-engine/.env',
  'apps/db-cli/.env',
  'apps/intelligence-worker/.env',
  'apps/publisher/.env',
  'apps/web/.env',
].filter((f) => existsSync(join(REPO_ROOT, f)));

// Directories never worth scanning for references.
const SKIP_DIRS = new Set(['node_modules', '.git', '.claude', 'dist', 'coverage', '.turbo', 'build']);
// Text file extensions to scan for references.
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.mdx',
  '.yml', '.yaml', '.sh', '.css', '.html', '.txt', '.example',
]);

/** Recursively collect scannable text-file contents (built once, reused per key). */
function collectCorpus(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      collectCorpus(abs, out);
    } else {
      // Skip the .env files themselves, lockfiles, and this script.
      if (name === '.env' || name.startsWith('.env.') || name.endsWith('.env')) continue;
      if (name === 'package-lock.json') continue;
      if (name === 'audit-env-keys.mjs') continue;
      if (!TEXT_EXT.has(extname(name))) continue;
      try {
        out.push(readFileSync(abs, 'utf8'));
      } catch { /* unreadable/binary -- skip */ }
    }
  }
  return out;
}

const CORPUS = collectCorpus(REPO_ROOT, []);

/**
 * Some keys are consumed by frameworks/tooling and legitimately never appear as
 * a literal in our own source. Treat these as always-referenced so the audit
 * does not flag them for removal.
 */
const ALWAYS_KEEP = new Set([
  'NODE_ENV',
  'PORT',
  'PATH',
  'TZ',
]);

/** Parse KEY names from a .env file body. Values are discarded immediately. */
function parseKeys(body) {
  const keys = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

/**
 * Count corpus files (outside .env) that reference a key name. Uses a
 * word-boundary match so a short key is not falsely counted as referenced just
 * because it is a substring of a longer identifier.
 */
function referenceCount(key) {
  const re = new RegExp(`\\b${key}\\b`);
  let n = 0;
  for (const text of CORPUS) {
    if (re.test(text)) n++;
  }
  return n;
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

let totalKeys = 0;
let totalStale = 0;
const staleByFile = {};

console.log(`\nEnv key audit  (${CLEAN ? 'CLEAN' : 'REPORT'} mode)`);
console.log('='.repeat(60));

for (const rel of ENV_FILES) {
  const abs = join(REPO_ROOT, rel);
  const body = readFileSync(abs, 'utf8');
  const keys = parseKeys(body);
  const referenced = [];
  const stale = [];

  for (const key of keys) {
    totalKeys++;
    if (ALWAYS_KEEP.has(key)) {
      referenced.push([key, '(framework)']);
      continue;
    }
    const n = referenceCount(key);
    if (n > 0) referenced.push([key, `${n} file(s)`]);
    else stale.push(key);
  }

  staleByFile[rel] = stale;
  totalStale += stale.length;

  console.log(`\n${rel}  --  ${keys.length} keys, ${referenced.length} referenced, ${stale.length} unreferenced`);
  if (stale.length) {
    for (const k of stale) console.log(`   UNREFERENCED  ${k}`);
  } else {
    console.log('   (all keys referenced)');
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`Total: ${totalKeys} keys across ${ENV_FILES.length} files; ${totalStale} unreferenced.`);

if (!CLEAN) {
  console.log('\nReport only. Re-run with --clean to back up each .env and remove the unreferenced keys.');
  process.exit(0);
}

// --- Cleanup mode: back up, then drop unreferenced keys ---
console.log('\nCleaning (backups written alongside each file):');
for (const rel of ENV_FILES) {
  const stale = staleByFile[rel];
  if (!stale.length) continue;
  const abs = join(REPO_ROOT, rel);
  const backup = `${abs}.bak-${timestamp()}`;
  copyFileSync(abs, backup);

  const staleSet = new Set(stale);
  const kept = readFileSync(abs, 'utf8')
    .split(/\r?\n/)
    .filter((raw) => {
      const m = raw.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      return !(m && staleSet.has(m[1]));
    })
    .join('\n');
  writeFileSync(abs, kept);
  console.log(`   ${rel}: removed ${stale.length} key(s); backup -> ${backup.replace(REPO_ROOT + '\\', '').replace(REPO_ROOT + '/', '')}`);
}
console.log('\nDone. Review the diffs and restart affected services.');
