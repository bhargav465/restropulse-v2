import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

await esbuild.build({
    entryPoints: [join(__dirname, '../dist/index.js')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: join(__dirname, '../dist/bundle.cjs'),
    external: ['node:*', 'readline', 'readline/promises', 'fs', 'path', 'url', 'crypto', 'os', 'stream', 'util', 'events', 'net', 'tls', 'http', 'https', 'zlib', 'buffer', 'string_decoder', 'querystring', 'dns', 'child_process', 'worker_threads', 'timers', 'process', 'module', 'vm', 'assert', 'perf_hooks', 'async_hooks', 'v8'],
    minify: true,
    sourcemap: false,
    banner: {
        js: '#!/usr/bin/env node\nvar __importMetaUrl=require("url").pathToFileURL(__filename).href;',
    },
    define: {
        'import.meta.url': '__importMetaUrl',
    },
});

console.log('Bundle created: dist/bundle.cjs');
