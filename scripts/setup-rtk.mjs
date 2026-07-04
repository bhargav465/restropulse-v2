#!/usr/bin/env node

/**
 * RTK (token optimizer) prerequisite checker and installer.
 *
 * Usage:
 *   node scripts/setup-rtk.mjs          # check + prompt to install
 *   node scripts/setup-rtk.mjs --install # auto-install without prompting
 *   node scripts/setup-rtk.mjs --check   # check only, exit 1 if missing
 *
 * Platforms: Windows (x86_64 MSVC), macOS (arm64/x86_64), Linux (x86_64/arm64 musl)
 * RTK releases: https://github.com/rtk-ai/rtk/releases
 */

import { execSync, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { platform, arch, homedir } from 'node:os';
import { existsSync, mkdirSync, createWriteStream, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

const AUTO_INSTALL = process.argv.includes('--install');
const CHECK_ONLY   = process.argv.includes('--check');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isInstalled(bin) {
  const result = spawnSync(bin, ['--version'], { encoding: 'utf8', shell: false });
  return result.status === 0;
}

function log(msg) { process.stdout.write(msg + '\n'); }
function ok(msg)  { log('[ok]   ' + msg); }
function warn(msg){ log('[warn] ' + msg); }
function info(msg){ log('[info] ' + msg); }
function err(msg) { process.stderr.write('[err]  ' + msg + '\n'); }

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question + ' [y/N] ', ans => {
    rl.close();
    resolve(ans.trim().toLowerCase() === 'y');
  }));
}

// ---------------------------------------------------------------------------
// Platform target detection
// ---------------------------------------------------------------------------

function getRtkTarget() {
  const os  = platform();   // 'win32', 'darwin', 'linux'
  const cpu = arch();       // 'x64', 'arm64'

  if (os === 'win32'  && cpu === 'x64')  return { asset: 'rtk-x86_64-pc-windows-msvc.zip',   ext: 'zip' };
  if (os === 'darwin' && cpu === 'arm64') return { asset: 'rtk-aarch64-apple-darwin.tar.gz',  ext: 'tgz' };
  if (os === 'darwin' && cpu === 'x64')  return { asset: 'rtk-x86_64-apple-darwin.tar.gz',    ext: 'tgz' };
  if (os === 'linux'  && cpu === 'x64')  return { asset: 'rtk-x86_64-unknown-linux-musl.tar.gz', ext: 'tgz' };
  if (os === 'linux'  && cpu === 'arm64') return { asset: 'rtk-aarch64-unknown-linux-musl.tar.gz', ext: 'tgz' };

  return null;
}

function getInstallDir() {
  const os = platform();
  if (os === 'win32') return join(homedir(), '.local', 'bin');
  return join(homedir(), '.local', 'bin');
}

// ---------------------------------------------------------------------------
// Fetch latest release tag from GitHub
// ---------------------------------------------------------------------------

async function getLatestVersion() {
  const url = 'https://api.github.com/repos/rtk-ai/rtk/releases/latest';
  const res = await fetch(url, { headers: { 'User-Agent': 'setup-rtk.mjs' } });
  if (!res.ok) throw new Error('GitHub API returned ' + res.status);
  const data = await res.json();
  return data.tag_name; // e.g. "v0.5.1"
}

// ---------------------------------------------------------------------------
// Download and extract
// ---------------------------------------------------------------------------

async function downloadFile(url, dest) {
  info('Downloading ' + url);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Download failed: ' + res.status);
  const file = createWriteStream(dest);
  await pipeline(res.body, file);
}

async function extractZip(zipPath, destDir) {
  // Use PowerShell on Windows (always available)
  const cmd = `powershell -NoProfile -Command "Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${destDir}'"`;
  execSync(cmd, { stdio: 'inherit' });
}

async function extractTarGz(tgzPath, destDir) {
  execSync(`tar -xzf "${tgzPath}" -C "${destDir}"`, { stdio: 'inherit' });
}

// ---------------------------------------------------------------------------
// Install RTK
// ---------------------------------------------------------------------------

async function installRtk() {
  const target = getRtkTarget();
  if (!target) {
    err('Unsupported platform: ' + platform() + '/' + arch());
    err('Install manually from https://github.com/rtk-ai/rtk/releases');
    process.exit(1);
  }

  const version = await getLatestVersion();
  info('Latest RTK version: ' + version);

  const installDir = getInstallDir();
  if (!existsSync(installDir)) {
    mkdirSync(installDir, { recursive: true });
    info('Created install dir: ' + installDir);
  }

  const downloadUrl = `https://github.com/rtk-ai/rtk/releases/download/${version}/${target.asset}`;
  const tmpFile = join(installDir, target.asset);

  await downloadFile(downloadUrl, tmpFile);

  if (target.ext === 'zip') {
    await extractZip(tmpFile, installDir);
  } else {
    await extractTarGz(tmpFile, installDir);
  }

  // Clean up archive
  try { execSync(`rm -f "${tmpFile}"`, { shell: true }); } catch (_) {}

  const binName  = platform() === 'win32' ? 'rtk.exe' : 'rtk';
  const binPath  = join(installDir, binName);

  if (!existsSync(binPath)) {
    err('Binary not found after extraction: ' + binPath);
    err('Check the archive contents at ' + installDir);
    process.exit(1);
  }

  if (platform() !== 'win32') {
    chmodSync(binPath, 0o755);
  }

  ok('RTK installed to ' + binPath);

  // Check if the install dir is already in PATH
  const pathDirs = (process.env.PATH || '').split(platform() === 'win32' ? ';' : ':');
  const inPath = pathDirs.some(d => d.replace(/\\/g, '/').toLowerCase() === installDir.replace(/\\/g, '/').toLowerCase());

  if (!inPath) {
    warn('');
    warn(installDir + ' is not in your PATH.');
    warn('Add it with one of the following (then restart your terminal and Claude Code):');
    if (platform() === 'win32') {
      warn('  PowerShell: [Environment]::SetEnvironmentVariable("Path", $env:Path + ";" + "' + installDir + '", "User")');
    } else {
      warn('  bash/zsh:   echo \'export PATH="$HOME/.local/bin:$PATH"\' >> ~/.bashrc');
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log('');
  log('RTK setup -- token optimizer for Claude Code');
  log('');

  if (isInstalled('rtk')) {
    const version = spawnSync('rtk', ['--version'], { encoding: 'utf8' }).stdout.trim();
    ok('RTK is installed: ' + version);
    log('');
    log('Hook is already configured in .claude/settings.local.json.');
    log('Restart Claude Code if it is running for the hook to take effect.');
    log('');
    log('Run "rtk gain" to see token savings.');
    return;
  }

  warn('RTK is not installed.');
  log('');

  if (CHECK_ONLY) {
    err('Check failed: rtk not found in PATH.');
    process.exit(1);
  }

  if (!AUTO_INSTALL) {
    const proceed = await ask('Install RTK now?');
    if (!proceed) {
      info('Skipped. Install manually from https://github.com/rtk-ai/rtk/releases');
      process.exit(0);
    }
  }

  await installRtk();
  log('');
  log('Done. Restart Claude Code for the PreToolUse hook to take effect.');
  log('Run "rtk gain" to track token savings over time.');
  log('');
}

main().catch(e => {
  err(e.message);
  process.exit(1);
});
