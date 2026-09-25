#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const appsDir = path.join(repoRoot, 'apps');

function listAppPackages() {
    if (!existsSync(appsDir)) {
        return [];
    }

    return readdirSync(appsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
            const appPath = path.join(appsDir, entry.name);
            const packageJsonPath = path.join(appPath, 'package.json');

            if (!existsSync(packageJsonPath)) {
                return null;
            }

            const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
            const hasCoverageScript = Boolean(packageJson.scripts?.['test:coverage']);

            return {
                appPath,
                appName: entry.name,
                workspaceName: packageJson.name,
                hasCoverageScript,
            };
        })
        .filter(Boolean)
        .filter((app) => app.hasCoverageScript);
}

function parseLcovMetrics(lcovPath) {
    const content = readFileSync(lcovPath, 'utf8');
    const lines = content.split(/\r?\n/);

    let lf = 0;
    let lh = 0;
    let fnf = 0;
    let fnh = 0;
    let brf = 0;
    let brh = 0;

    for (const line of lines) {
        if (line.startsWith('LF:')) lf += Number(line.slice(3)) || 0;
        if (line.startsWith('LH:')) lh += Number(line.slice(3)) || 0;
        if (line.startsWith('FNF:')) fnf += Number(line.slice(4)) || 0;
        if (line.startsWith('FNH:')) fnh += Number(line.slice(4)) || 0;
        if (line.startsWith('BRF:')) brf += Number(line.slice(4)) || 0;
        if (line.startsWith('BRH:')) brh += Number(line.slice(4)) || 0;
    }

    const toPct = (covered, total) => (total > 0 ? Number(((covered / total) * 100).toFixed(2)) : 100);

    return {
        statements: toPct(lh, lf),
        branches: toPct(brh, brf),
        functions: toPct(fnh, fnf),
        lines: toPct(lh, lf),
    };
}

function readCoverageMetrics(appPath) {
    const coverageDir = path.join(appPath, 'coverage');
    const lcovPath = path.join(coverageDir, 'lcov.info');

    if (existsSync(lcovPath)) {
        return parseLcovMetrics(lcovPath);
    }

    return null;
}

function runCoverage(workspaceName) {
    console.log(`\nRunning coverage for ${workspaceName}...`);

    const result = spawnSync('npm', ['exec', '-w', workspaceName, '--', 'vitest', 'run', '--coverage'], {
        cwd: repoRoot,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });

    return result.status === 0;
}

function printSummary(rows) {
    console.log('\nConsolidated coverage summary');
    console.log('Workspace                      Statements  Branches  Functions  Lines');
    console.log('---------------------------------------------------------------------');

    for (const row of rows) {
        const workspace = row.workspaceName.padEnd(30, ' ');
        const statements = `${row.metrics.statements.toFixed(2)}%`.padStart(10, ' ');
        const branches = `${row.metrics.branches.toFixed(2)}%`.padStart(9, ' ');
        const functions = `${row.metrics.functions.toFixed(2)}%`.padStart(10, ' ');
        const lines = `${row.metrics.lines.toFixed(2)}%`.padStart(7, ' ');

        console.log(`${workspace} ${statements} ${branches} ${functions} ${lines}`);
    }
}

const apps = listAppPackages();

if (apps.length === 0) {
    console.error('No app workspaces with test:coverage script were found.');
    process.exit(1);
}

const summaryRows = [];

for (const app of apps) {
    const ok = runCoverage(app.workspaceName);
    if (!ok) {
        console.error(`Coverage run failed for ${app.workspaceName}`);
        process.exit(1);
    }

    const metrics = readCoverageMetrics(app.appPath);

    if (!metrics) {
        console.error(`lcov.info not found for ${app.workspaceName} in ${path.join(app.appPath, 'coverage')}`);
        process.exit(1);
    }

    summaryRows.push({
        workspaceName: app.workspaceName,
        metrics,
    });
}

printSummary(summaryRows);
