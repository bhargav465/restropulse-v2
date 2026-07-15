#!/usr/bin/env node
/**
 * Bundle apps/api for Vercel serverless deployment.
 *
 * - Entry: apps/api/src/vercel.ts (exports the request handler)
 * - Workspace packages (@restropulse/*) are bundled from TypeScript source.
 * - Heavy/native npm deps stay external and are installed by Vercel from the
 *   generated deploy package.json.
 * - '@restropulse/telemetry/server' and '@restropulse/secrets' are aliased to
 *   lightweight shims (no pino/OTEL/Azure in the bundle).
 *
 * Output: dist-vercel/  →  api/index.mjs + package.json + vercel.json
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist-vercel');
mkdirSync(path.join(outDir, 'api'), { recursive: true });

const EXTERNAL = [
    'express', 'cors', 'mongodb', 'bcryptjs', 'jsonwebtoken', 'multer',
    'csv-parse', 'axios', 'form-data', 'firebase-admin', '@anthropic-ai/sdk',
    'node-cron', 'dotenv',
];

await build({
    entryPoints: [path.join(root, 'apps/api/src/vercel.ts')],
    outfile: path.join(outDir, 'api/index.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    sourcemap: false,
    minify: false,
    external: EXTERNAL,
    alias: {
        '@restropulse/telemetry/server': path.join(root, 'apps/api/src/vercel-shims/telemetry-server.ts'),
        '@restropulse/secrets': path.join(root, 'apps/api/src/vercel-shims/secrets.ts'),
    },
    logLevel: 'info',
});

// Runtime deps for Vercel to install (versions mirrored from the workspace).
const deps = {
    '@anthropic-ai/sdk': '^0.68.0',
    'axios': '^1.13.2',
    'bcryptjs': '^3.0.2',
    'cors': '^2.8.5',
    'csv-parse': '^5.6.0',
    'dotenv': '^16.6.1',
    'express': '^4.18.2',
    'firebase-admin': '^13.6.0',
    'form-data': '^4.0.5',
    'jsonwebtoken': '^9.0.3',
    'mongodb': '^6.12.0',
    'multer': '^1.4.5-lts.2',
    'node-cron': '^4.2.1',
};

writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({
    name: 'restropulse-api',
    version: '2.0.0',
    private: true,
    type: 'module',
    engines: { node: '>=20' },
    dependencies: deps,
}, null, 2));

writeFileSync(path.join(outDir, 'vercel.json'), JSON.stringify({
    $schema: 'https://openapi.vercel.sh/vercel.json',
    version: 2,
    functions: { 'api/index.mjs': { maxDuration: 30, memory: 1024 } },
    rewrites: [{ source: '/(.*)', destination: '/api/index' }],
}, null, 2));

console.log('✓ dist-vercel ready');
