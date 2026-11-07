#!/usr/bin/env node
// Apply the per-environment robots policy to a built web bundle.
//
// Usage: node scripts/apply-robots-policy.mjs <staging|production> [distDir]
//
// staging    -> adds "X-Robots-Tag: noindex, nofollow" to staticwebapp.config.json
//               globalHeaders and writes a robots.txt that disallows everything.
// production -> asserts X-Robots-Tag is absent from globalHeaders and writes a
//               robots.txt that allows everything. Exits 1 if a noindex header
//               is present, so a staging config can never ship to production.
//
// Runs after `turbo build --filter=@restropulse/web` and before the SWA upload.
// The committed apps/web/public/staticwebapp.config.json carries no robots
// header so the same source builds for both environments.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROBOTS_HEADER = 'X-Robots-Tag';
const NOINDEX_VALUE = 'noindex, nofollow';

const env = process.argv[2];
const distDir = process.argv[3] ?? path.join('apps', 'web', 'dist');

if (env !== 'staging' && env !== 'production') {
    console.error('Usage: apply-robots-policy.mjs <staging|production> [distDir]');
    process.exit(2);
}

const configPath = path.join(distDir, 'staticwebapp.config.json');
const robotsPath = path.join(distDir, 'robots.txt');

if (!existsSync(configPath)) {
    console.error(`staticwebapp.config.json not found at ${configPath}. Build the web app first.`);
    process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
config.globalHeaders = config.globalHeaders ?? {};

const existingKey = Object.keys(config.globalHeaders).find(
    (k) => k.toLowerCase() === ROBOTS_HEADER.toLowerCase()
);

if (env === 'staging') {
    if (existingKey) delete config.globalHeaders[existingKey];
    config.globalHeaders[ROBOTS_HEADER] = NOINDEX_VALUE;
    writeFileSync(robotsPath, 'User-agent: *\nDisallow: /\n');
    console.log(`[robots-policy] staging: set ${ROBOTS_HEADER}: ${NOINDEX_VALUE}; wrote Disallow robots.txt`);
} else {
    if (existingKey) {
        console.error(
            `[robots-policy] production: ${existingKey} is present in globalHeaders (${config.globalHeaders[existingKey]}). ` +
            'Refusing to deploy a noindex bundle to production.'
        );
        process.exit(1);
    }
    writeFileSync(robotsPath, 'User-agent: *\nAllow: /\n');
    console.log('[robots-policy] production: no robots header present; wrote Allow robots.txt');
}

// Remove the documentation-only key so the deployed config stays minimal.
delete config._comment;

writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
