#!/usr/bin/env node

/**
 * MCP Server prerequisite checker and installer.
 *
 * Usage:
 *   node scripts/setup-mcp.mjs          # check + prompt to install
 *   node scripts/setup-mcp.mjs --install # auto-install everything missing
 *   node scripts/setup-mcp.mjs --check   # check only, exit 1 if anything missing
 *
 * What it covers:
 *   1. Node.js  (>= 18)          -- required by all servers
 *   2. npm      (>= 9)           -- required by npx-based servers
 *   3. Go       (>= 1.21)        -- required to build mcp-language-server
 *   4. Bun      (>= 1.0)         -- required to run codebase-rag
 *   5. typescript                 -- global, used by TS language server
 *   6. typescript-language-server -- global, the LSP engine
 *   7. mcp-language-server        -- Go binary, the MCP<->LSP bridge
 *   8. codebase-rag               -- local clone, run via bun
 *   9. @modelcontextprotocol/server-memory -- npx-fetched, verified via dry-run
 */

import { execSync, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { platform, homedir } from 'node:os';
import { existsSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isWin = platform() === 'win32';

// Standard location for locally-cloned MCP servers
const MCP_SERVERS_DIR = join(homedir(), '.mcp-servers');
const CODEBASE_RAG_DIR = join(MCP_SERVERS_DIR, 'codebase-rag');
const CODEBASE_RAG_REPO = 'https://github.com/joinQuantish/codebase-rag.git';

// Workspace root (resolved from script location)
const WORKSPACE_ROOT = new URL('..', import.meta.url).pathname
    .replace(/^\/([A-Z]:)/i, '$1') // fix Windows drive letter
    .replace(/\/$/, '');

function run(cmd, opts = {}) {
    try {
        return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
    } catch {
        return null;
    }
}

function semver(raw) {
    if (!raw) return null;
    const m = raw.match(/(\d+)\.(\d+)\.(\d+)/);
    return m ? { major: +m[1], minor: +m[2], patch: +m[3], raw: m[0] } : null;
}

function gte(ver, major, minor = 0) {
    if (!ver) return false;
    return ver.major > major || (ver.major === major && ver.minor >= minor);
}

function log(tag, msg) {
    const labels = {
        ok: '[OK]',
        miss: '[MISSING]',
        warn: '[WARN]',
        info: '[INFO]',
        step: '[STEP]',
        fail: '[FAIL]',
    };
    console.log(`  ${labels[tag] || tag}  ${msg}`);
}

async function confirm(question) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(`\n${question} [Y/n] `, (ans) => {
            rl.close();
            resolve(!ans || ans.toLowerCase().startsWith('y'));
        });
    });
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function checkNode() {
    const ver = semver(run('node --version'));
    if (gte(ver, 18)) {
        log('ok', `Node.js ${ver.raw}`);
        return true;
    }
    log('miss', 'Node.js >= 18 is required');
    return false;
}

function checkNpm() {
    const ver = semver(run('npm --version'));
    if (gte(ver, 9)) {
        log('ok', `npm ${ver.raw}`);
        return true;
    }
    log('miss', 'npm >= 9 is required');
    return false;
}

function checkGo() {
    const ver = semver(run('go version'));
    if (gte(ver, 1, 21)) {
        log('ok', `Go ${ver.raw}`);
        return true;
    }
    log('miss', 'Go >= 1.21 is required (needed for mcp-language-server)');
    return false;
}

function checkGlobalNpm(pkg, binary) {
    const bin = binary || pkg;
    const ver = semver(run(`${bin} --version`));
    if (ver) {
        log('ok', `${pkg} ${ver.raw}`);
        return true;
    }
    log('miss', `${pkg} not found globally`);
    return false;
}

function checkMcpLanguageServer() {
    const help = run('mcp-language-server --help');
    if (help !== null) {
        log('ok', 'mcp-language-server');
        return true;
    }
    log('miss', 'mcp-language-server not found on PATH');
    return false;
}

function checkBun() {
    const ver = semver(run('bun --version'));
    if (gte(ver, 1)) {
        log('ok', `Bun ${ver.raw}`);
        return true;
    }
    log('miss', 'Bun >= 1.0 is required (needed to run codebase-rag)');
    return false;
}

function checkCodebaseRag() {
    const serverFile = join(CODEBASE_RAG_DIR, 'src', 'server.ts');
    const nodeModules = join(CODEBASE_RAG_DIR, 'node_modules');
    if (existsSync(serverFile) && existsSync(nodeModules)) {
        log('ok', `codebase-rag (${CODEBASE_RAG_DIR})`);
        return true;
    }
    if (existsSync(CODEBASE_RAG_DIR)) {
        log('warn', `codebase-rag cloned but dependencies not installed (${CODEBASE_RAG_DIR})`);
    } else {
        log('miss', `codebase-rag not found at ${CODEBASE_RAG_DIR}`);
    }
    return false;
}

function checkNpxPackage(pkg) {
    // A lightweight check: resolve the package without executing it.
    // npx --yes --package <pkg> -- node -e "" exits 0 if the package resolves.
    const result = spawnSync(
        'npx',
        ['--yes', '--package', pkg, '--', 'node', '-e', '""'],
        { encoding: 'utf8', stdio: 'pipe', timeout: 60_000 }
    );
    if (result.status === 0) {
        log('ok', `${pkg} (npx resolvable)`);
        return true;
    }
    log('warn', `${pkg} could not be resolved via npx (may work on first real use)`);
    return true; // non-blocking -- npx will fetch at runtime
}

// ---------------------------------------------------------------------------
// Installers
// ---------------------------------------------------------------------------

function installGo() {
    log('step', 'Installing Go...');
    if (isWin) {
        const wingetCheck = run('winget --version');
        if (wingetCheck) {
            log('info', 'Using winget to install Go');
            execSync('winget install --id GoLang.Go --accept-source-agreements --accept-package-agreements', { stdio: 'inherit' });
        } else {
            const chocoCheck = run('choco --version');
            if (chocoCheck) {
                log('info', 'Using Chocolatey to install Go');
                execSync('choco install golang -y', { stdio: 'inherit' });
            } else {
                log('fail', 'Neither winget nor Chocolatey found.');
                log('info', 'Install Go manually from https://go.dev/dl/ and re-run this script.');
                return false;
            }
        }
    } else {
        // macOS / Linux
        const brewCheck = run('brew --version');
        if (brewCheck) {
            execSync('brew install go', { stdio: 'inherit' });
        } else {
            log('fail', 'Homebrew not found. Install Go manually from https://go.dev/dl/');
            return false;
        }
    }
    // Verify
    if (!checkGo()) {
        log('warn', 'Go installed but not yet on PATH. Open a new terminal and re-run.');
        return false;
    }
    return true;
}

function installGlobalNpm(pkg) {
    log('step', `Installing ${pkg} globally...`);
    execSync(`npm install -g ${pkg}`, { stdio: 'inherit' });
}

function installMcpLanguageServer() {
    log('step', 'Installing mcp-language-server via go install...');
    execSync('go install github.com/isaacphi/mcp-language-server@latest', {
        stdio: 'inherit',
        env: { ...process.env },
    });
    // Check GOPATH/bin is on PATH
    if (!checkMcpLanguageServer()) {
        const gopath = run('go env GOPATH') || '';
        const binDir = gopath ? `${gopath}${isWin ? '\\' : '/'}bin` : '$GOPATH/bin';
        log('warn', `Installed but not on PATH. Add ${binDir} to your PATH, then re-run.`);
        return false;
    }
    return true;
}

function installBun() {
    log('step', 'Installing Bun...');
    if (isWin) {
        // Official Bun install for Windows via PowerShell
        const result = spawnSync(
            'powershell',
            ['-Command', 'irm bun.sh/install.ps1 | iex'],
            { stdio: 'inherit', timeout: 120_000 }
        );
        if (result.status !== 0) {
            log('fail', 'Bun installation failed via PowerShell.');
            log('info', 'Install Bun manually from https://bun.sh/ and re-run.');
            return false;
        }
    } else {
        // macOS / Linux
        const result = spawnSync(
            'bash',
            ['-c', 'curl -fsSL https://bun.sh/install | bash'],
            { stdio: 'inherit', timeout: 120_000 }
        );
        if (result.status !== 0) {
            log('fail', 'Bun installation failed.');
            log('info', 'Install Bun manually from https://bun.sh/ and re-run.');
            return false;
        }
    }
    // Add bun to PATH for the current process so subsequent steps work
    // without requiring a terminal restart.
    const bunBinDir = isWin
        ? join(homedir(), '.bun', 'bin')
        : join(homedir(), '.bun', 'bin');
    if (existsSync(bunBinDir) && !process.env.PATH.includes(bunBinDir)) {
        process.env.PATH = `${bunBinDir}${isWin ? ';' : ':'}${process.env.PATH}`;
        log('info', `Added ${bunBinDir} to PATH for this session`);
    }

    if (!checkBun()) {
        log('warn', 'Bun installed but not yet on PATH. Open a new terminal and re-run.');
        return false;
    }
    return true;
}

function installCodebaseRag() {
    log('step', `Cloning codebase-rag into ${CODEBASE_RAG_DIR}...`);

    // Create parent directory if needed
    if (!existsSync(MCP_SERVERS_DIR)) {
        execSync(`${isWin ? 'mkdir' : 'mkdir -p'} "${MCP_SERVERS_DIR}"`, { stdio: 'inherit' });
    }

    // Clone if not already present
    if (!existsSync(join(CODEBASE_RAG_DIR, '.git'))) {
        execSync(`git clone ${CODEBASE_RAG_REPO} "${CODEBASE_RAG_DIR}"`, { stdio: 'inherit' });
    } else {
        log('info', 'codebase-rag already cloned, pulling latest...');
        execSync('git pull', { cwd: CODEBASE_RAG_DIR, stdio: 'inherit' });
    }

    // Install dependencies with bun
    log('step', 'Installing codebase-rag dependencies with bun...');
    execSync('bun install', { cwd: CODEBASE_RAG_DIR, stdio: 'inherit' });

    if (!checkCodebaseRag()) {
        log('fail', 'codebase-rag installation failed.');
        return false;
    }
    return true;
}

function indexCodebaseRag() {
    log('step', `Indexing workspace with codebase-rag (${WORKSPACE_ROOT})...`);
    const cliPath = join(CODEBASE_RAG_DIR, 'src', 'cli.ts');
    execSync(`bun run "${cliPath}" index "${WORKSPACE_ROOT}"`, {
        cwd: CODEBASE_RAG_DIR,
        stdio: 'inherit',
        timeout: 300_000, // 5 min max for large repos
    });
    log('ok', 'Workspace indexed successfully');
}

function installGitHooks() {
    log('step', 'Installing git hooks for automatic re-indexing...');

    const gitDir = join(WORKSPACE_ROOT, '.git');
    if (!existsSync(gitDir)) {
        log('warn', 'Not a git repository -- skipping hook installation.');
        return false;
    }

    const hooksDir = join(gitDir, 'hooks');
    if (!existsSync(hooksDir)) {
        mkdirSync(hooksDir, { recursive: true });
    }

    // The hook body is the same for all three hooks:
    // Run the reindex script in the background so git isn't blocked.
    const hookBody = isWin
        ? `#!/bin/sh
# Auto-generated by setup-mcp.mjs -- re-indexes codebase-rag after code changes
# Runs in background so git returns immediately
node "$(git rev-parse --show-toplevel)/scripts/reindex-rag.mjs" --quiet &
`
        : `#!/bin/sh
# Auto-generated by setup-mcp.mjs -- re-indexes codebase-rag after code changes
# Runs in background so git returns immediately
nohup node "$(git rev-parse --show-toplevel)/scripts/reindex-rag.mjs" --quiet >/dev/null 2>&1 &
`;

    const hookNames = ['post-merge', 'post-checkout', 'post-rewrite'];
    let installed = 0;
    const installedNames = [];

    for (const name of hookNames) {
        const hookPath = join(hooksDir, name);
        if (existsSync(hookPath)) {
            // Check if it's ours or a user-created hook
            const existing = readFileSync(hookPath, 'utf8');
            if (existing.includes('setup-mcp.mjs')) {
                log('info', `${name} hook already installed, updating...`);
            } else {
                log('warn', `${name} hook already exists (not ours) -- skipping. Add reindex manually if desired.`);
                continue;
            }
        }
        writeFileSync(hookPath, hookBody, { mode: 0o755 });
        if (!isWin) {
            chmodSync(hookPath, 0o755);
        }
        installed++;
        installedNames.push(name);
    }

    if (installed > 0) {
        log('ok', `Installed ${installed} git hook(s): ${installedNames.join(', ')}`);
    } else {
        log('info', 'No new git hooks were installed (all already present).');
    }
    return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    const args = process.argv.slice(2);
    const autoInstall = args.includes('--install');
    const checkOnly = args.includes('--check');

    console.log('\n  RestroPulse -- MCP Server Prerequisites\n');
    console.log('  Checking installed tools...\n');

    // ---- Checks ----------------------------------------------------------

    const results = {
        node: checkNode(),
        npm: checkNpm(),
        go: checkGo(),
        bun: checkBun(),
        typescript: checkGlobalNpm('typescript', 'tsc'),
        tsLangServer: checkGlobalNpm('typescript-language-server', 'typescript-language-server'),
        mcpLangServer: checkMcpLanguageServer(),
        codebaseRag: checkCodebaseRag(),
    };

    console.log('\n  Checking npx-fetched packages...\n');

    results.serverMemory = checkNpxPackage('@modelcontextprotocol/server-memory');

    // ---- Summary ---------------------------------------------------------

    const missing = Object.entries(results)
        .filter(([, ok]) => !ok)
        .map(([k]) => k);

    console.log('');

    if (missing.length === 0) {
        console.log('  All prerequisites satisfied. MCP servers are ready to use.\n');
        process.exit(0);
    }

    console.log(`  Missing: ${missing.join(', ')}\n`);

    if (checkOnly) {
        process.exit(1);
    }

    // ---- Blocking: Node/npm must already exist ---------------------------

    if (!results.node || !results.npm) {
        log('fail', 'Node.js and npm must be installed before this script can install anything.');
        log('info', 'Install Node.js >= 18 from https://nodejs.org/ and re-run.');
        process.exit(1);
    }

    // ---- Install prompt --------------------------------------------------

    if (!autoInstall) {
        const proceed = await confirm('  Install missing prerequisites?');
        if (!proceed) {
            console.log('  Aborted.\n');
            process.exit(1);
        }
    }

    // ---- Install sequence ------------------------------------------------

    let allGood = true;

    // Go (needed before mcp-language-server)
    if (!results.go) {
        if (!installGo()) allGood = false;
    }

    // typescript (global)
    if (!results.typescript) {
        try { installGlobalNpm('typescript'); } catch { allGood = false; }
    }

    // typescript-language-server (global)
    if (!results.tsLangServer) {
        try { installGlobalNpm('typescript-language-server'); } catch { allGood = false; }
    }

    // mcp-language-server (go install)
    if (!results.mcpLangServer) {
        // Re-check Go in case it was just installed
        if (checkGo() || results.go) {
            if (!installMcpLanguageServer()) allGood = false;
        } else {
            log('warn', 'Skipping mcp-language-server -- Go is not available.');
            allGood = false;
        }
    }

    // Bun (needed before codebase-rag)
    if (!results.bun) {
        if (!installBun()) allGood = false;
    }

    // codebase-rag (clone + bun install)
    if (!results.codebaseRag) {
        if (checkBun() || results.bun) {
            try {
                if (!installCodebaseRag()) allGood = false;
            } catch (err) {
                log('fail', `codebase-rag install error: ${err.message}`);
                allGood = false;
            }
        } else {
            log('warn', 'Skipping codebase-rag -- Bun is not available.');
            allGood = false;
        }
    }

    // ---- Index workspace -------------------------------------------------

    if (checkCodebaseRag() && checkBun()) {
        try {
            indexCodebaseRag();
        } catch (err) {
            log('warn', `Workspace indexing failed: ${err.message}`);
            log('info', 'You can index later by running: npm run reindex');
        }
    }

    // ---- Git hooks -------------------------------------------------------

    try {
        await installGitHooks();
    } catch (err) {
        log('warn', `Git hook installation failed: ${err.message}`);
    }

    // ---- Final report ----------------------------------------------------

    console.log('');
    if (allGood) {
        console.log('  All prerequisites installed successfully.\n');
        console.log('  Next steps:');
        console.log('    1. Reload VS Code to pick up MCP servers from .vscode/mcp.json');
        console.log('    2. See docs/MCP-SETUP.md for tool-routing rules and troubleshooting');
        console.log('    3. Git hooks will auto-reindex on pull/checkout/rebase');
        console.log(`    4. Manual re-index: npm run reindex\n`);
    } else {
        console.log('  Some items could not be installed automatically.');
        console.log('  Fix the issues above, then re-run: node scripts/setup-mcp.mjs --check\n');
        process.exit(1);
    }
}

main();
