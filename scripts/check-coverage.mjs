#!/usr/bin/env node

// Checks coverage from lcov.info against config/coverage-baseline.json.
// Usage: node scripts/check-coverage.mjs <workspace-name> <lcov-path>
// Exit code 1 if coverage drops below baseline threshold.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const workspaceName = process.argv[2];
const lcovPath = process.argv[3];

if (!workspaceName || !lcovPath) {
    console.error('Usage: check-coverage.mjs <workspace-name> <lcov-path>');
    process.exit(1);
}

if (!existsSync(lcovPath)) {
    console.error(`lcov.info not found at: ${lcovPath}`);
    process.exit(1);
}

const baselinePath = path.join(repoRoot, 'config', 'coverage-baseline.json');
if (!existsSync(baselinePath)) {
    console.error(`Baseline file not found at: ${baselinePath}`);
    process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const thresholds = baseline[workspaceName];

if (!thresholds) {
    console.log(`No baseline entry for ${workspaceName}, skipping coverage check.`);
    process.exit(0);
}

function parseLcovMetrics(filePath) {
    const content = readFileSync(filePath, 'utf8');
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
        lines: toPct(lh, lf),
        branches: toPct(brh, brf),
        functions: toPct(fnh, fnf),
    };
}

const actual = parseLcovMetrics(lcovPath);

let failed = false;
const results = [];

for (const metric of ['lines', 'branches', 'functions']) {
    const threshold = thresholds[metric] ?? 85;
    const value = actual[metric];
    const pass = value >= threshold;

    if (!pass) failed = true;

    results.push({ metric, value, threshold, pass });
}

// Print summary
console.log(`\nCoverage report for ${workspaceName}`);
console.log('------------------------------------------');
for (const r of results) {
    const status = r.pass ? 'PASS' : 'FAIL';
    console.log(`  ${r.metric.padEnd(12)} ${r.value.toFixed(2).padStart(7)}% / ${r.threshold}%  ${status}`);
}
console.log('');

// Write GitHub step summary if available
if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    const summaryLines = [
        `### Coverage: ${workspaceName}`,
        '',
        '| Metric | Actual | Threshold | Status |',
        '|--------|--------|-----------|--------|',
    ];
    for (const r of results) {
        const icon = r.pass ? 'pass' : 'FAIL';
        summaryLines.push(`| ${r.metric} | ${r.value.toFixed(2)}% | ${r.threshold}% | ${icon} |`);
    }
    summaryLines.push('');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryLines.join('\n'));
}

if (failed) {
    console.error(`Coverage below threshold for ${workspaceName}. See details above.`);
    process.exit(1);
}

console.log(`All coverage thresholds met for ${workspaceName}.`);
