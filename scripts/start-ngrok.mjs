#!/usr/bin/env node

/**
 * Start an ngrok tunnel pointing to the local API server (port 3001).
 * Installs ngrok automatically if it is not already on PATH.
 *
 * Usage:
 *   npm run ngrok
 *   node scripts/start-ngrok.mjs
 *
 * Environment variables (read from root .env or inherited from shell):
 *   NGROK_AUTH_TOKEN  -- required: your ngrok auth token
 *   NGROK_DOMAIN      -- optional: static domain; omit for a random ephemeral URL
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, createWriteStream, chmodSync, mkdirSync } from 'node:fs';
import { platform, arch, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isWin = platform() === 'win32';

const WORKSPACE_ROOT = fileURLToPath(new URL('..', import.meta.url))
    .replace(/[\\/]$/, '');

function run(cmd) {
    try {
        return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
    } catch {
        return null;
    }
}

function log(tag, msg) {
    const labels = { ok: '[OK]', miss: '[MISSING]', warn: '[WARN]', info: '[INFO]', fail: '[FAIL]' };
    console.log(`  ${labels[tag] ?? tag}  ${msg}`);
}

// ---------------------------------------------------------------------------
// Load root .env (no dotenv dependency — parse manually)
// ---------------------------------------------------------------------------

function loadRootEnv() {
    const envPath = join(WORKSPACE_ROOT, '.env');
    if (!existsSync(envPath)) return;
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (key && !(key in process.env)) {
            process.env[key] = val;
        }
    }
}

// ---------------------------------------------------------------------------
// Check / install ngrok
// ---------------------------------------------------------------------------

const NGROK_MIN_VERSION = [3, 20, 0];

function isNgrokInstalled() {
    return run('ngrok version') !== null;
}

function getNgrokVersion() {
    const out = run('ngrok version');
    if (!out) return null;
    const m = out.match(/(\d+)\.(\d+)\.(\d+)/);
    return m ? [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])] : null;
}

function isNgrokVersionOk() {
    const v = getNgrokVersion();
    if (!v) return false;
    for (let i = 0; i < NGROK_MIN_VERSION.length; i++) {
        if (v[i] > NGROK_MIN_VERSION[i]) return true;
        if (v[i] < NGROK_MIN_VERSION[i]) return false;
    }
    return true;
}

function getNgrokTarget() {
    const os  = platform();
    const cpu = arch();
    const base = 'https://bin.equinox.io/c/bNyj1mQVY4c';
    if (os === 'win32'  && cpu === 'x64')   return { url: `${base}/ngrok-v3-stable-windows-amd64.zip`,  ext: 'zip', bin: 'ngrok.exe' };
    if (os === 'darwin' && cpu === 'arm64') return { url: `${base}/ngrok-v3-stable-darwin-arm64.zip`,   ext: 'zip', bin: 'ngrok' };
    if (os === 'darwin' && cpu === 'x64')  return { url: `${base}/ngrok-v3-stable-darwin-amd64.zip`,   ext: 'zip', bin: 'ngrok' };
    if (os === 'linux'  && cpu === 'x64')  return { url: `${base}/ngrok-v3-stable-linux-amd64.tgz`,    ext: 'tgz', bin: 'ngrok' };
    if (os === 'linux'  && cpu === 'arm64') return { url: `${base}/ngrok-v3-stable-linux-arm64.tgz`,   ext: 'tgz', bin: 'ngrok' };
    return null;
}

async function downloadFile(url, dest) {
    log('info', `Downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    const file = createWriteStream(dest);
    await pipeline(res.body, file);
}

async function installNgrok() {
    const target = getNgrokTarget();
    if (!target) {
        log('fail', `Unsupported platform: ${platform()}/${arch()}. Install manually: https://ngrok.com/download`);
        process.exit(1);
    }

    const installDir = join(homedir(), '.local', 'bin');
    if (!existsSync(installDir)) mkdirSync(installDir, { recursive: true });

    const fileName = target.url.split('/').pop();
    const tmpFile  = join(installDir, fileName);

    await downloadFile(target.url, tmpFile);

    if (target.ext === 'zip') {
        execSync(
            `powershell -NoProfile -Command "Expand-Archive -Force -Path '${tmpFile}' -DestinationPath '${installDir}'"`,
            { stdio: 'inherit' },
        );
    } else {
        execSync(`tar -xzf "${tmpFile}" -C "${installDir}"`, { stdio: 'inherit' });
    }

    try { execSync(`${isWin ? 'del' : 'rm'} "${tmpFile}"`, { stdio: 'pipe' }); } catch (_) {}

    const binPath = join(installDir, target.bin);
    if (!existsSync(binPath)) {
        log('fail', `Binary not found after extraction: ${binPath}`);
        process.exit(1);
    }
    if (!isWin) chmodSync(binPath, 0o755);

    log('ok', `ngrok installed to ${binPath}`);

    // Update PATH for this process so the new binary is found immediately
    process.env.PATH = `${installDir}${isWin ? ';' : ':'}${process.env.PATH}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

loadRootEnv();

const authToken = process.env.NGROK_AUTH_TOKEN;
const domain = process.env.NGROK_DOMAIN;
const apiPort = 3001;

if (!authToken) {
    log('fail', 'NGROK_AUTH_TOKEN is not set.');
    log('info', 'Add it to your root .env file:');
    log('info', '  NGROK_AUTH_TOKEN=<your-token>');
    log('info', '  Get yours at: https://dashboard.ngrok.com/authtokens');
    process.exit(1);
}

if (!isNgrokInstalled() || !isNgrokVersionOk()) {
    if (isNgrokInstalled()) {
        const v = getNgrokVersion();
        log('info', `ngrok ${v ? v.join('.') : '?'} is below minimum ${NGROK_MIN_VERSION.join('.')} -- upgrading...`);
    } else {
        log('info', 'ngrok not found -- installing...');
    }
    await installNgrok();
} else {
    log('ok', `ngrok ${run('ngrok version')}`);
}

// Configure auth token (idempotent)
log('info', 'Configuring auth token...');
const configResult = run(`ngrok config add-authtoken ${authToken}`);
if (configResult === null) {
    log('fail', 'Failed to configure ngrok auth token.');
    process.exit(1);
}
log('ok', 'Auth token configured');

// Print webhook URL
const tunnelUrl = domain ? `https://${domain}` : `http://localhost:4040`;
const webhookUrl = `${domain ? `https://${domain}` : '<ngrok-url>'}/api/subscriptions/webhook`;

console.log('');
log('info', `Starting ngrok tunnel -> http://localhost:${apiPort}`);
if (domain) {
    log('info', `Webhook URL: ${webhookUrl}`);
    log('info', 'Set this URL in: Razorpay Dashboard -> Settings -> Webhooks');
} else {
    log('info', 'No NGROK_DOMAIN set — a random URL will be assigned.');
    log('info', 'Find your webhook URL in the ngrok console output below.');
}
console.log('');

// Start the tunnel — runs in the foreground; Ctrl+C to stop
const args = domain
    ? ['http', `--domain=${domain}`, String(apiPort)]
    : ['http', String(apiPort)];

const child = spawn('ngrok', args, { stdio: 'inherit', shell: isWin });

child.on('error', (err) => {
    log('fail', `Failed to start ngrok: ${err.message}`);
    process.exit(1);
});

child.on('exit', (code) => {
    process.exit(code ?? 0);
});
