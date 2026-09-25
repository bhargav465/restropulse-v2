#!/usr/bin/env node

/**
 * Dev tooling prerequisite checker and installer.
 *
 * Installs:
 *   1. mprocs  -- TUI process runner for split-pane dev terminal
 *   2. ngrok   -- HTTPS tunnel for local webhook testing
 *
 * Usage:
 *   node scripts/setup-dev.mjs           # check + prompt to install
 *   node scripts/setup-dev.mjs --install # auto-install without prompting
 *   node scripts/setup-dev.mjs --check   # check only, exit 1 if anything missing
 *
 * Platforms: Windows (x86_64), macOS (arm64/x86_64), Linux (x86_64)
 * mprocs releases: https://github.com/pvolok/mprocs/releases
 * ngrok releases:  https://ngrok.com/download
 */

import { execSync, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { platform, arch, homedir } from 'node:os';
import { existsSync, mkdirSync, createWriteStream, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const AUTO_INSTALL = process.argv.includes('--install');
const CHECK_ONLY   = process.argv.includes('--check');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isWin = platform() === 'win32';

function run(cmd) {
    try {
        return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
    } catch {
        return null;
    }
}

function log(tag, msg) {
    const labels = { ok: '[OK]   ', miss: '[MISS] ', info: '[INFO] ', step: '[STEP] ', fail: '[FAIL] ', warn: '[WARN] ' };
    console.log(`  ${labels[tag] ?? tag}  ${msg}`);
}

async function ask(question) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(`\n  ${question} [Y/n] `, ans => {
        rl.close();
        resolve(!ans || ans.trim().toLowerCase().startsWith('y'));
    }));
}

function getInstallDir() {
    return join(homedir(), '.local', 'bin');
}

async function fetchLatestGitHubTag(repo) {
    const url = `https://api.github.com/repos/${repo}/releases/latest`;
    const res = await fetch(url, { headers: { 'User-Agent': 'setup-dev.mjs' } });
    if (!res.ok) throw new Error(`GitHub API error ${res.status} for ${repo}`);
    const data = await res.json();
    return data.tag_name; // e.g. "v0.6.5"
}

async function downloadFile(url, dest) {
    log('info', `Downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    const file = createWriteStream(dest);
    await pipeline(res.body, file);
}

async function extractZip(zipPath, destDir) {
    execSync(
        `powershell -NoProfile -Command "Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${destDir}'"`,
        { stdio: 'inherit' },
    );
}

async function extractTarGz(tgzPath, destDir) {
    execSync(`tar -xzf "${tgzPath}" -C "${destDir}"`, { stdio: 'inherit' });
}

// ---------------------------------------------------------------------------
// mprocs
// ---------------------------------------------------------------------------

function isMprocsInstalled() {
    return run('mprocs --version') !== null;
}

function checkMprocs() {
    if (isMprocsInstalled()) {
        log('ok', `mprocs ${run('mprocs --version')}`);
        return true;
    }
    log('miss', 'mprocs not found on PATH');
    return false;
}

function getMprocsTarget() {
    const os  = platform();
    const cpu = arch();
    // Asset names from https://github.com/pvolok/mprocs/releases
    // Format: mprocs-VERSION-{os}-{arch}[.zip|.tar.gz]
    if (os === 'win32'  && cpu === 'x64')   return { asset: 'mprocs-VERSION-windows-x86_64.zip',        ext: 'zip', bin: 'mprocs.exe' };
    if (os === 'darwin' && cpu === 'arm64') return { asset: 'mprocs-VERSION-darwin-aarch64.tar.gz',      ext: 'tgz', bin: 'mprocs' };
    if (os === 'darwin' && cpu === 'x64')  return { asset: 'mprocs-VERSION-darwin-x86_64.tar.gz',        ext: 'tgz', bin: 'mprocs' };
    if (os === 'linux'  && cpu === 'x64')  return { asset: 'mprocs-VERSION-linux-x86_64-musl.tar.gz',    ext: 'tgz', bin: 'mprocs' };
    if (os === 'linux'  && cpu === 'arm64') return { asset: 'mprocs-VERSION-linux-aarch64-musl.tar.gz',  ext: 'tgz', bin: 'mprocs' };
    return null;
}

async function installMprocs() {
    const target = getMprocsTarget();
    if (!target) {
        log('fail', `Unsupported platform for mprocs: ${platform()}/${arch()}`);
        log('info', 'Install manually from https://github.com/pvolok/mprocs/releases');
        return false;
    }

    const version = await fetchLatestGitHubTag('pvolok/mprocs');
    log('step', `Installing mprocs ${version}...`);

    const installDir = getInstallDir();
    if (!existsSync(installDir)) mkdirSync(installDir, { recursive: true });

    const assetName = target.asset.replace('VERSION', version.replace(/^v/, ''));
    const url = `https://github.com/pvolok/mprocs/releases/download/${version}/${assetName}`;
    const tmpFile = join(installDir, assetName);

    await downloadFile(url, tmpFile);

    if (target.ext === 'zip') {
        await extractZip(tmpFile, installDir);
    } else {
        await extractTarGz(tmpFile, installDir);
    }

    try { run(`${isWin ? 'del' : 'rm'} "${tmpFile}"`); } catch (_) {}

    const binPath = join(installDir, target.bin);
    if (!existsSync(binPath)) {
        log('fail', `Binary not found after extraction: ${binPath}`);
        return false;
    }
    if (!isWin) chmodSync(binPath, 0o755);

    log('ok', `mprocs installed to ${binPath}`);
    ensureOnPath(installDir);
    return true;
}

// ---------------------------------------------------------------------------
// ngrok
// ---------------------------------------------------------------------------

// Minimum required ngrok agent version (older agents are rejected by the service)
const NGROK_MIN_VERSION = [3, 20, 0];

function isNgrokInstalled() {
    return run('ngrok version') !== null;
}

function getNgrokVersion() {
    // "ngrok version 3.21.0" or "ngrok version 3.3.1"
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
    return true; // equal
}

function getNgrokTarget() {
    const os  = platform();
    const cpu = arch();
    // Stable release URLs always resolve to the latest ngrok v3 stable binary
    const base = 'https://bin.equinox.io/c/bNyj1mQVY4c';
    if (os === 'win32'  && cpu === 'x64')   return { url: `${base}/ngrok-v3-stable-windows-amd64.zip`,   ext: 'zip', bin: 'ngrok.exe' };
    if (os === 'darwin' && cpu === 'arm64') return { url: `${base}/ngrok-v3-stable-darwin-arm64.zip`,    ext: 'zip', bin: 'ngrok' };
    if (os === 'darwin' && cpu === 'x64')  return { url: `${base}/ngrok-v3-stable-darwin-amd64.zip`,    ext: 'zip', bin: 'ngrok' };
    if (os === 'linux'  && cpu === 'x64')  return { url: `${base}/ngrok-v3-stable-linux-amd64.tgz`,     ext: 'tgz', bin: 'ngrok' };
    if (os === 'linux'  && cpu === 'arm64') return { url: `${base}/ngrok-v3-stable-linux-arm64.tgz`,    ext: 'tgz', bin: 'ngrok' };
    return null;
}

function checkNgrok() {
    if (!isNgrokInstalled()) {
        log('miss', 'ngrok not found on PATH');
        return false;
    }
    if (!isNgrokVersionOk()) {
        const v = getNgrokVersion();
        log('miss', `ngrok ${v ? v.join('.') : '?'} is below minimum required ${NGROK_MIN_VERSION.join('.')}`);
        return false;
    }
    log('ok', `ngrok ${run('ngrok version')}`);
    return true;
}

async function installNgrok() {
    const target = getNgrokTarget();
    if (!target) {
        log('fail', `Unsupported platform for ngrok: ${platform()}/${arch()}`);
        log('info', 'Install manually from https://ngrok.com/download');
        return false;
    }

    log('step', 'Installing latest ngrok...');

    const installDir = getInstallDir();
    if (!existsSync(installDir)) mkdirSync(installDir, { recursive: true });

    const fileName = target.url.split('/').pop();
    const tmpFile  = join(installDir, fileName);

    await downloadFile(target.url, tmpFile);

    if (target.ext === 'zip') {
        await extractZip(tmpFile, installDir);
    } else {
        await extractTarGz(tmpFile, installDir);
    }

    try { run(`${isWin ? 'del' : 'rm'} "${tmpFile}"`); } catch (_) {}

    const binPath = join(installDir, target.bin);
    if (!existsSync(binPath)) {
        log('fail', `Binary not found after extraction: ${binPath}`);
        return false;
    }
    if (!isWin) chmodSync(binPath, 0o755);

    log('ok', `ngrok installed to ${binPath}`);
    ensureOnPath(installDir);
    return true;
}

// ---------------------------------------------------------------------------
// PATH helper
// ---------------------------------------------------------------------------

function ensureOnPath(dir) {
    const sep = isWin ? ';' : ':';
    const pathDirs = (process.env.PATH || '').split(sep);
    const normalise = d => d.replace(/\\/g, '/').toLowerCase().replace(/\/$/, '');
    if (!pathDirs.some(d => normalise(d) === normalise(dir))) {
        log('warn', `${dir} is not in your PATH.`);
        if (isWin) {
            log('info', `Add it in PowerShell:`);
            log('info', `  [Environment]::SetEnvironmentVariable("Path", $env:Path + ";${dir}", "User")`);
        } else {
            log('info', `Add to ~/.bashrc or ~/.zshrc:`);
            log('info', `  export PATH="${dir}:$PATH"`);
        }
        log('info', 'Then open a new terminal for the change to take effect.');
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log('\n  RestroPulse -- Dev Tooling Setup\n');
    console.log('  Checking installed tools...\n');

    const results = {
        mprocs: checkMprocs(),
        ngrok:  checkNgrok(),
    };

    console.log('');

    const missing = Object.entries(results).filter(([, ok]) => !ok).map(([k]) => k);

    if (missing.length === 0) {
        console.log('  All dev tools are installed.\n');
        console.log('  Run `npm run dev:free` to start all services in the mprocs TUI.\n');
        process.exit(0);
    }

    console.log(`  Missing: ${missing.join(', ')}\n`);

    if (CHECK_ONLY) {
        process.exit(1);
    }

    if (!AUTO_INSTALL) {
        const proceed = await ask('Install missing tools now?');
        if (!proceed) {
            log('info', 'Skipped. Install manually and re-run.');
            process.exit(0);
        }
    }

    console.log('');
    let allGood = true;

    if (!results.mprocs) {
        try {
            if (!await installMprocs()) allGood = false;
        } catch (e) {
            log('fail', `mprocs install error: ${e.message}`);
            allGood = false;
        }
    }

    if (!results.ngrok) {
        try {
            if (!await installNgrok()) allGood = false;
        } catch (e) {
            log('fail', `ngrok install error: ${e.message}`);
            allGood = false;
        }
    }

    console.log('');
    if (allGood) {
        console.log('  All dev tools installed successfully.\n');
        console.log('  Next steps:');
        console.log('    1. Open a new terminal (so PATH changes take effect)');
        console.log('    2. Add NGROK_AUTH_TOKEN to the root .env file');
        console.log('    3. Run `npm run dev:free` to launch the mprocs TUI\n');
    } else {
        console.log('  Some tools could not be installed automatically.');
        console.log('  Fix the issues above, then re-run: node scripts/setup-dev.mjs --check\n');
        process.exit(1);
    }
}

main().catch(e => {
    log('fail', e.message);
    process.exit(1);
});
