#!/usr/bin/env node

/**
 * Re-index the workspace for codebase-rag semantic search.
 *
 * Usage:
 *   node scripts/reindex-rag.mjs          # full re-index
 *   node scripts/reindex-rag.mjs --quiet  # suppress progress output (for git hooks)
 *
 * Called automatically by git hooks (post-merge, post-checkout) and
 * available manually via:  npm run reindex
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CODEBASE_RAG_DIR = join(homedir(), '.mcp-servers', 'codebase-rag');
const CLI_PATH = join(CODEBASE_RAG_DIR, 'src', 'cli.ts');
const WORKSPACE_ROOT = new URL('..', import.meta.url).pathname
    .replace(/^\/([A-Z]:)/i, '$1')
    .replace(/\/$/, '');

const quiet = process.argv.includes('--quiet');

function log(msg) {
    if (!quiet) console.log(`  [reindex] ${msg}`);
}

// Pre-flight checks
if (!existsSync(CLI_PATH)) {
    log(`codebase-rag not found at ${CODEBASE_RAG_DIR}`);
    log('Run "npm run setup:mcp" to install it first.');
    process.exit(quiet ? 0 : 1); // silent exit in hook mode so git isn't blocked
}

let bunCmd = 'bun';
try {
    execSync('bun --version', { stdio: 'pipe' });
} catch {
    log('Bun is not installed or not on PATH. Skipping re-index.');
    process.exit(quiet ? 0 : 1);
}

// Run the index
try {
    log(`Indexing ${WORKSPACE_ROOT} ...`);
    execSync(`${bunCmd} run "${CLI_PATH}" index "${WORKSPACE_ROOT}"`, {
        cwd: CODEBASE_RAG_DIR,
        stdio: quiet ? 'pipe' : 'inherit',
        timeout: 300_000,
    });
    log('Done.');
} catch (err) {
    log(`Indexing failed: ${err.message}`);
    process.exit(quiet ? 0 : 1);
}
