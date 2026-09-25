#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(name);
  if (idx < 0 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

function readJson(pathArg) {
  if (!pathArg) return null;
  const abs = resolve(ROOT, pathArg);
  if (!existsSync(abs)) throw new Error(`Missing file: ${abs}`);
  return JSON.parse(readFileSync(abs, 'utf8'));
}

function toKeySet(value) {
  const keys = new Set();
  if (!value) return keys;

  if (Array.isArray(value)) {
    for (const row of value) {
      if (typeof row === 'string') keys.add(row);
      else if (row && typeof row.name === 'string') keys.add(row.name);
      else if (row && typeof row.key === 'string') keys.add(row.key);
    }
    return keys;
  }

  if (value.properties && typeof value.properties === 'object') {
    for (const key of Object.keys(value.properties)) keys.add(key);
    return keys;
  }

  if (typeof value === 'object') {
    for (const key of Object.keys(value)) keys.add(key);
  }
  return keys;
}

const IGNORE_PREFIXES = ['WEBSITE_', 'SCM_', 'DOCKER_', 'APPSETTING_', 'WEBSITES_'];
const IGNORE_EXACT = new Set(['PORT', 'NODE_ENV']);

function shouldIgnoreCloudKey(key) {
  if (IGNORE_EXACT.has(key)) return true;
  return IGNORE_PREFIXES.some((p) => key.startsWith(p));
}

function main() {
  const inventoryPath = getArg('--inventory') ?? 'reports/env/inventory.json';
  const inventoryJson = readJson(inventoryPath);
  if (!inventoryJson?.inventory) {
    throw new Error(`Invalid inventory JSON: ${inventoryPath}`);
  }

  const rows = inventoryJson.inventory;
  const serverApps = new Set(['api', 'publisher', 'content-engine', 'intelligence-worker']);
  const serverPackages = new Set(['package:publishing', 'package:telemetry', 'package:db', 'package:shared']);

  function intersects(setLike, expected) {
    return (setLike ?? []).some((x) => expected.has(x));
  }

  function isServerRelevant(row) {
    if (row.state === 'stale' || row.state === 'workflow-only') return false;
    if (row.buildTime || row.key.startsWith('VITE_')) return false;
    if (IGNORE_EXACT.has(row.key)) return false;
    if (intersects(row.manifestApps, serverApps)) return true;
    if (intersects(row.schemaRequiredBy, serverApps) || intersects(row.schemaOptionalBy, serverApps)) return true;
    if (intersects(row.usedInComponents, serverApps) || intersects(row.usedInComponents, serverPackages)) return true;
    return false;
  }

  const appServiceRelevant = rows.filter(isServerRelevant);
  const appServiceRequired = new Set(appServiceRelevant.filter((x) => x.required).map((x) => x.key));
  const appServiceOptional = new Set(appServiceRelevant.filter((x) => !x.required).map((x) => x.key));
  const appServiceAll = new Set([...appServiceRequired, ...appServiceOptional]);
  const workflowOnlyKeys = rows
    .filter((row) => row.state === 'workflow-only')
    .map((row) => row.key)
    .sort();

  const targets = [
    { name: 'appservice-staging', value: readJson(getArg('--appservice-staging')) },
    { name: 'appservice-production', value: readJson(getArg('--appservice-production')) },
    { name: 'swa-staging', value: readJson(getArg('--swa-staging')) },
    { name: 'swa-production', value: readJson(getArg('--swa-production')) },
  ].filter((t) => t.value !== null);

  const results = [];
  for (const target of targets) {
    const cloudKeys = [...toKeySet(target.value)].filter((k) => !shouldIgnoreCloudKey(k)).sort();
    const cloudSet = new Set(cloudKeys);

    const isAppService = target.name.startsWith('appservice-');
    const requiredSet = isAppService ? appServiceRequired : new Set();
    const optionalSet = isAppService ? appServiceOptional : new Set();
    const fullSet = isAppService ? appServiceAll : new Set();

    const missingRequired = [...requiredSet].filter((k) => !cloudSet.has(k)).sort();
    const missingOptional = [...optionalSet].filter((k) => !cloudSet.has(k)).sort();
    const stale = cloudKeys.filter((k) => !fullSet.has(k)).sort();

    results.push({
      target: target.name,
      cloudKeyCount: cloudKeys.length,
      missingRequiredKeys: missingRequired,
      missingOptionalKeys: missingOptional,
      cloudOnlyKeys: stale,
    });
  }

  const out = {
    generatedAt: new Date().toISOString(),
    inventoryPath,
    appServiceRelevantKeyCount: appServiceAll.size,
    appServiceRequiredKeyCount: appServiceRequired.size,
    workflowOnlyKeyCount: workflowOnlyKeys.length,
    workflowOnlyKeys,
    results,
  };

  const outPath = join(ROOT, 'reports', 'env', 'cloud-diff.json');
  if (!existsSync(dirname(outPath))) mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.log(`Cloud diff report: ${outPath.replace(ROOT + '\\', '').replaceAll('\\', '/')}`);
  for (const row of results) {
    console.log(
      `${row.target}: missing-required=${row.missingRequiredKeys.length}, missing-optional=${row.missingOptionalKeys.length}, cloud-only=${row.cloudOnlyKeys.length}, keys=${row.cloudKeyCount}`,
    );
  }
}

main();
