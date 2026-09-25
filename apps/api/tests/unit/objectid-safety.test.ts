/**
 * ObjectId safety guard.
 *
 * MongoDB stores _id as ObjectId for restaurant/post/cycle documents. Querying
 * with a raw string (e.g. { _id: restaurantId as any }) silently matches zero
 * documents instead of throwing -- a class of bug that is very hard to spot in
 * logs. This test catches any file in the monorepo that constructs a raw-string
 * _id filter without going through toObjectId().
 *
 * Pattern rejected:   { _id: <identifier> as any }
 * Pattern accepted:   { _id: toObjectId(<identifier>) as any }
 *                     { _id: new ObjectId(...) }
 *                     { _id: postDoc._id }   (already an ObjectId from a DB doc)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const WORKTREE_ROOT = join(__dirname, '../../../../');

// Directories to scan for raw _id string patterns.
const SCAN_DIRS = [
    'apps/api/src',
    'apps/content-engine/src',
    'apps/publisher/src',
    'packages/publishing/src',
];

// Files legitimately allowed to use raw _id (e.g. seed data with string IDs).
// intelligenceScans uses a randomUUID() string as its _id by design (see
// routes/intelligence.ts insertOne), never an ObjectId -- toObjectId() would
// break these lookups, not fix them.
const ALLOWED_FILES: string[] = [
    'apps/api/src/routes/intelligence.ts',
    'apps/api/src/services/intelligence/pipeline.ts',
];

function walk(dir: string): string[] {
    const results: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
            results.push(...walk(full));
        } else if (['.ts', '.js'].includes(extname(full))) {
            results.push(full);
        }
    }
    return results;
}

/**
 * Returns lines in a file that look like raw _id string queries.
 * Matches patterns like:
 *   { _id: someVar as any }
 *   { _id: someVar as any,
 *   _id: someVar as any }
 * but NOT:
 *   { _id: toObjectId(...) as any }
 *   { _id: new ObjectId(...) }
 *   { _id: postDoc._id }
 *   { _id: cycleDoc._id }
 */
function findRawIdQueries(filePath: string): { line: number; text: string }[] {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const hits: { line: number; text: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match _id: <something> as any  where <something> is NOT a toObjectId() call,
        // NOT a new ObjectId(), and NOT a ._id property access (already an ObjectId).
        if (/_id:\s+(?!toObjectId\b)(?!new ObjectId\b)(?!\S+\._id\b)\S+\s+as\s+any/.test(line)) {
            hits.push({ line: i + 1, text: line.trim() });
        }
    }
    return hits;
}

describe('ObjectId safety: no raw _id string queries in server-side code', () => {
    for (const dir of SCAN_DIRS) {
        const absDir = join(WORKTREE_ROOT, dir);
        let files: string[];
        try {
            files = walk(absDir);
        } catch {
            // Directory may not exist in all environments
            continue;
        }

        for (const file of files) {
            const relPath = file.replace(WORKTREE_ROOT, '').replace(/\\/g, '/');
            if (ALLOWED_FILES.some(allowed => relPath.includes(allowed))) continue;

            it(`${relPath} — no raw _id string queries`, () => {
                const hits = findRawIdQueries(file);
                expect(hits, `Raw _id string query found in ${relPath}:\n${hits.map(h => `  line ${h.line}: ${h.text}`).join('\n')}`).toHaveLength(0);
            });
        }
    }
});
