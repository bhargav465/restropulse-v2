#!/usr/bin/env node

/**
 * Set environment variable profiles across the workspace.
 *
 * Usage:
 *   node scripts/set-env-profile.mjs test    # small windows, fast crons
 *   node scripts/set-env-profile.mjs prod    # restore production defaults
 *   node scripts/set-env-profile.mjs show    # print current values for all tracked keys
 *
 * Only updates keys defined in the profiles below — never touches sensitive
 * values (MONGODB_URI, JWT_SECRET, ENCRYPTION_KEY, API keys, etc.).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

const PROFILES = {

  // ── test ─────────────────────────────────────────────────────────────────
  // Compress all time windows to minutes/seconds so you can run through the
  // full content pipeline in a single dev session without waiting hours.
  test: {
    'apps/content-engine/.env': {
      // Time windows (minutes)
      ROLLING_WINDOW_MINS: '5',            // materialise slots 5 min ahead
      POST_APPROVAL_BUFFER_MINS: '2',      // feedback closes 2 min before scheduled
      CYCLE_APPROVAL_BUFFER_MINS: '10',    // feedback closes 10 min before cycle start

      // Processor schedules — 6-field cron (node-cron v4): field 1 = seconds
      CRON_PENDING_POSTS:   '*/15 * * * * *',  // every 15 seconds
      CRON_PENDING_CYCLES:  '*/15 * * * * *',
      CRON_ROLLING_WINDOW:  '*/15 * * * * *',
      CRON_REVISIONS:       '*/15 * * * * *',
      CRON_DEADLINES:       '*/15 * * * * *',
      CRON_CYCLE_SYNC:      '*/15 * * * * *',

      ENABLED_PLATFORMS:    'INSTAGRAM',
    },
    'apps/api/.env': {
      // Scheduling — must match content-engine values so API deadline checks stay in sync
      MIN_SCHEDULE_AHEAD_MINS:      '5',   // ASAP posts scheduled 5 min from now
      POST_APPROVAL_BUFFER_MINS:    '2',
      CYCLE_APPROVAL_BUFFER_MINS:   '10',
      ENABLED_PLATFORMS:            'INSTAGRAM',
    },
    'apps/publisher/.env': {
      CRON_PUBLISHER: '*/15 * * * * *',   // every 15 seconds
    },
  },

  // ── prod ─────────────────────────────────────────────────────────────────
  // Restore all values to production defaults.
  prod: {
    'apps/content-engine/.env': {
      // Time windows (minutes) — converted from shared constants
      ROLLING_WINDOW_MINS:        '2880',  // 48 h
      POST_APPROVAL_BUFFER_MINS:  '120',   // 2 h
      CYCLE_APPROVAL_BUFFER_MINS: '4320',  // 72 h (> rolling window intentionally)

      // Processor schedules — 5-field cron: every 2 minutes
      CRON_PENDING_POSTS:   '*/2 * * * *',
      CRON_PENDING_CYCLES:  '*/2 * * * *',
      CRON_ROLLING_WINDOW:  '*/2 * * * *',
      CRON_REVISIONS:       '*/2 * * * *',
      CRON_DEADLINES:       '*/2 * * * *',
      CRON_CYCLE_SYNC:      '*/2 * * * *',

      ENABLED_PLATFORMS:    'INSTAGRAM',
    },
    'apps/api/.env': {
      // Scheduling — must match content-engine values so API deadline checks stay in sync
      MIN_SCHEDULE_AHEAD_MINS:      '150', // 2.5 h (2 h buffer + 30 min review)
      POST_APPROVAL_BUFFER_MINS:    '120', // 2 h
      CYCLE_APPROVAL_BUFFER_MINS:   '4320', // 72 h
      ENABLED_PLATFORMS:            'INSTAGRAM',
    },
    'apps/publisher/.env': {
      CRON_PUBLISHER: '*/5 * * * *',      // every 5 minutes
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function patchEnv(filePath, overrides) {
  const abs = join(ROOT, filePath);
  if (!existsSync(abs)) {
    console.log(`  [SKIP] ${filePath} does not exist`);
    return;
  }

  let content = readFileSync(abs, 'utf8');
  const changes = [];

  for (const [key, value] of Object.entries(overrides)) {
    const pattern = new RegExp(`^(${key}\\s*=).*`, 'm');
    if (pattern.test(content)) {
      const before = content.match(pattern)[0];
      content = content.replace(pattern, `$1${value}`);
      const after = `${key}=${value}`;
      if (before !== after) changes.push({ key, before: before.split('=')[1]?.trim(), after: value });
    } else {
      // Key not present — append it
      content = content.trimEnd() + `\n${key}=${value}\n`;
      changes.push({ key, before: '(not set)', after: value });
    }
  }

  if (changes.length > 0) {
    writeFileSync(abs, content, 'utf8');
    console.log(`  ${filePath}`);
    for (const { key, before, after } of changes) {
      const arrow = before === after ? '  (unchanged)' : `  ${before}  →  ${after}`;
      console.log(`    ${key.padEnd(30)} ${arrow}`);
    }
  } else {
    console.log(`  ${filePath}  (already up to date)`);
  }
}

function showEnv(filePath, keys) {
  const abs = join(ROOT, filePath);
  if (!existsSync(abs)) {
    console.log(`  ${filePath}  [not found]`);
    return;
  }
  const content = readFileSync(abs, 'utf8');
  console.log(`  ${filePath}`);
  for (const key of keys) {
    const m = content.match(new RegExp(`^${key}\\s*=(.*)`, 'm'));
    const val = m ? m[1].trim() || '(empty)' : '(not set)';
    console.log(`    ${key.padEnd(30)} ${val}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const cmd = process.argv[2];

if (!cmd || !['test', 'prod', 'show'].includes(cmd)) {
  console.log('Usage: node scripts/set-env-profile.mjs <test|prod|show>');
  console.log('');
  console.log('  test   Small windows + fast crons for local testing');
  console.log('  prod   Restore production defaults');
  console.log('  show   Print current values for all tracked keys');
  process.exit(1);
}

if (cmd === 'show') {
  console.log('\nCurrent tracked env values:\n');
  const allKeys = {};
  for (const profile of Object.values(PROFILES)) {
    for (const [file, overrides] of Object.entries(profile)) {
      allKeys[file] = [...new Set([...(allKeys[file] ?? []), ...Object.keys(overrides)])];
    }
  }
  for (const [file, keys] of Object.entries(allKeys)) showEnv(file, keys);
  console.log('');
  process.exit(0);
}

const profile = PROFILES[cmd];
console.log(`\nApplying profile: ${cmd}\n`);
for (const [file, overrides] of Object.entries(profile)) {
  patchEnv(file, overrides);
}
console.log('\nDone. Restart the relevant services to pick up the changes.\n');
