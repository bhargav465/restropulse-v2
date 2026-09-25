#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = new Set(process.argv.slice(2));
const WRITE_TAGS = args.has('--write-tags');
const PRINT_JSON = args.has('--json');

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.turbo',
  '.claude',
]);

const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.md']);
const ALWAYS_ACTIVE = new Set(['NODE_ENV', 'PORT', 'PATH', 'TZ']);
const PLATFORM_PREFIXES = ['WEBSITE_', 'SCM_', 'DOCKER_', 'APPSETTING_', 'WEBSITES_'];
const IGNORE_USAGE_KEYS = new Set(['DEV', 'PROD', 'TEST', 'GITHUB_TOKEN', 'PATH', 'PORTS', 'TEST_KEY']);
const PROCESS_ENV_DOT_RE = /(?<!['"`])\bprocess\.env\.([A-Z][A-Z0-9_]*)/g;
const PROCESS_ENV_BRACKET_RE = /(?<!['"`])\bprocess\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g;
const IMPORT_META_ENV_DOT_RE = /(?<!['"`])\bimport\.meta\.env\.([A-Z][A-Z0-9_]*)/g;
const IMPORT_META_ENV_BRACKET_RE = /(?<!['"`])\bimport\.meta\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g;
const WORKFLOW_ENV_EXPR_RE = /\${{\s*(?:vars|secrets)\.([A-Z][A-Z0-9_]*)\s*}}/g;
const SCHEMA_OBJECT_RE = /schema\s*:\s*z(?:\s*\.\s*[A-Za-z_][A-Za-z0-9_]*\([^)]*\))*\s*\.\s*object\s*\(\s*\{/gms;

function walk(dir, collector) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, collector);
    else collector(abs);
  }
}

function rel(abs) {
  return relative(ROOT, abs).replaceAll('\\', '/');
}

function isTrackedEnvFile(relPath) {
  const base = relPath.split('/').at(-1) ?? '';
  if (base === '.env' || base === '.env.example') return true;
  if (base.startsWith('.env.') && base.endsWith('.example')) return true;
  return false;
}

function getEnvFiles() {
  const files = [];
  walk(ROOT, (abs) => {
    const rp = rel(abs);
    if (!isTrackedEnvFile(rp)) return;
    files.push(abs);
  });
  return files.sort();
}

function parseEnvEntries(abs) {
  const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
  const entries = [];
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const m = raw.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=(.*)$/);
    if (!m) continue;
    entries.push({ key: m[1], line: i + 1, raw });
  }
  return entries;
}

function componentFromPath(relPath) {
  if (relPath.startsWith('apps/')) return relPath.split('/')[1];
  if (relPath.startsWith('packages/')) return `package:${relPath.split('/')[1]}`;
  if (relPath.startsWith('.github/workflows/')) return 'workflow';
  if (relPath.startsWith('tests/')) return 'tests';
  if (relPath.startsWith('scripts/')) return 'scripts';
  return 'root';
}

function scanEnvUsage() {
  const usage = new Map();

  function addUsage(key, relPath) {
    if (IGNORE_USAGE_KEYS.has(key)) return;
    if (key.endsWith('_')) return;
    if (key.startsWith('GITHUB_')) return;
    if (!usage.has(key)) {
      usage.set(key, { files: new Set(), components: new Set(), inWorkflows: false });
    }
    const u = usage.get(key);
    u.files.add(relPath);
    u.components.add(componentFromPath(relPath));
    if (relPath.startsWith('.github/workflows/')) u.inWorkflows = true;
  }

  walk(ROOT, (abs) => {
    const rp = rel(abs);
    if (!TEXT_EXT.has(extname(abs)) && !rp.startsWith('.github/workflows/')) return;
    if (isTrackedEnvFile(rp)) return;
    const text = readFileSync(abs, 'utf8');

    for (const m of text.matchAll(PROCESS_ENV_DOT_RE)) addUsage(m[1], rp);
    for (const m of text.matchAll(PROCESS_ENV_BRACKET_RE)) addUsage(m[1], rp);
    for (const m of text.matchAll(IMPORT_META_ENV_DOT_RE)) addUsage(m[1], rp);
    for (const m of text.matchAll(IMPORT_META_ENV_BRACKET_RE)) addUsage(m[1], rp);

    if (rp.startsWith('.github/workflows/')) {
      for (const m of text.matchAll(WORKFLOW_ENV_EXPR_RE)) addUsage(m[1], rp);
    }
  });

  return usage;
}

function parseManifest() {
  const manifestFile = join(ROOT, 'packages/secrets/src/manifest.ts');
  if (!existsSync(manifestFile)) return new Map();
  const text = readFileSync(manifestFile, 'utf8');
  const map = new Map();

  const entryRe = /\{[^{}]*key:\s*'([^']+)'[^{}]*apps:\s*\[([^\]]*)\][^{}]*required:\s*(true|false)(?:[^{}]*buildTime:\s*(true|false))?[^{}]*\}/gs;
  for (const m of text.matchAll(entryRe)) {
    const key = m[1];
    const apps = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    const required = m[3] === 'true';
    const buildTime = m[4] === 'true';
    map.set(key, { apps, required, buildTime });
  }
  return map;
}

function extractBalancedBlock(text, startIndex) {
  let depth = 0;
  let inString = false;
  let stringChar = '';
  for (let i = startIndex; i < text.length; i += 1) {
    const ch = text[i];
    const prev = i > 0 ? text[i - 1] : '';
    if (inString) {
      if (ch === stringChar && prev !== '\\') inString = false;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true;
      stringChar = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(startIndex + 1, i);
    }
  }
  return '';
}

function parseSchemaRequirements() {
  const schema = new Map();
  const files = [];
  walk(join(ROOT, 'apps'), (abs) => {
    if (extname(abs) !== '.ts') return;
    files.push(abs);
  });

  for (const abs of files) {
    const text = readFileSync(abs, 'utf8');
    if (!text.includes('loadAndValidateEnv')) continue;
    const rp = rel(abs);
    const component = componentFromPath(rp);
    for (const match of text.matchAll(SCHEMA_OBJECT_RE)) {
      const openBraceOffset = match[0].lastIndexOf('{');
      if (openBraceOffset < 0 || match.index === undefined) continue;
      const openBrace = match.index + openBraceOffset;
      const body = extractBalancedBlock(text, openBrace);
      if (!body) continue;

      const lines = body.split(/\r?\n/);
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];
        const keyMatch = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*:\s*(.+)$/);
        if (!keyMatch) {
          i += 1;
          continue;
        }
        const key = keyMatch[1];
        let expr = keyMatch[2];
        while (!expr.includes(',') && i + 1 < lines.length) {
          i += 1;
          expr += ` ${lines[i].trim()}`;
        }
        const exprTrim = expr.replace(/,\s*$/, '').trim();
        const isIndirectIdentifier = /^[A-Za-z_][A-Za-z0-9_]*$/.test(exprTrim);
        const required =
          !isIndirectIdentifier &&
          !expr.includes('.optional(') &&
          !expr.includes('.optional()') &&
          !expr.includes('.default(');
        if (!schema.has(key)) schema.set(key, { requiredBy: new Set(), optionalBy: new Set() });
        const target = schema.get(key);
        if (required) target.requiredBy.add(component);
        else target.optionalBy.add(component);
        i += 1;
      }
    }
  }

  return schema;
}

function isSecretKey(key) {
  return /(SECRET|TOKEN|PASSWORD|MONGODB|URI|KEY|CONNECTION|JWT|FIREBASE|RAZORPAY|AZURE|APPINSIGHTS)/i.test(key);
}

function deriveOwner(key, declarationFiles, manifestMeta) {
  const manifest = manifestMeta.get(key);
  if (manifest) {
    if (manifest.apps.length === 1) return manifest.apps[0];
    if (manifest.apps.length > 1) return 'shared';
  }

  const owners = new Set(
    declarationFiles.map((f) => {
      const rp = rel(f);
      if (rp.startsWith('apps/')) return rp.split('/')[1];
      if (rp.startsWith('tests/')) return 'tests';
      return 'root';
    }),
  );
  if (owners.size === 1) return [...owners][0];
  if (owners.size > 1) return 'shared';
  return 'unknown';
}

function inferEnvironmentScope(files) {
  const vals = new Set();
  for (const abs of files) {
    const rp = rel(abs);
    if (rp.includes('.production')) vals.add('prod');
    else if (rp.includes('.staging')) vals.add('staging');
    else vals.add('dev');
  }
  return [...vals].sort();
}

function classify(declarations, usage, schemaMeta, manifestMeta) {
  const allKeys = new Set([
    ...declarations.keys(),
    ...usage.keys(),
    ...schemaMeta.keys(),
    ...manifestMeta.keys(),
  ]);

  const items = [];
  for (const key of [...allKeys].sort()) {
    const declaredIn = declarations.get(key) ?? [];
    const used = usage.get(key);
    const schema = schemaMeta.get(key);
    const manifest = manifestMeta.get(key);
    const declared = declaredIn.length > 0;
    const hasUsage = Boolean(used);
    const hasSchema = Boolean(schema);
    const hasManifest = Boolean(manifest);
    const active =
      ALWAYS_ACTIVE.has(key) ||
      hasUsage ||
      hasSchema ||
      hasManifest ||
      PLATFORM_PREFIXES.some((p) => key.startsWith(p));
    const usedOnlyInWorkflow =
      hasUsage &&
      used.components.size > 0 &&
      [...used.components].every((c) => c === 'workflow');
    let state;
    if (declared) state = active ? 'active' : 'stale';
    else if (usedOnlyInWorkflow) state = 'workflow-only';
    else state = 'orphan';

    const required =
      Boolean(manifest?.required) ||
      Boolean(schema && schema.requiredBy.size > 0);

    const buildTime =
      Boolean(manifest?.buildTime) ||
      key.startsWith('VITE_');

    const runtime = !buildTime;
    const secret = isSecretKey(key);

    items.push({
      key,
      state,
      required,
      runtime,
      buildTime,
      secret,
      owner: deriveOwner(key, declaredIn, manifestMeta),
      environments: inferEnvironmentScope(declaredIn),
      declaredIn: declaredIn.map(rel),
      usedInFiles: used ? [...used.files].sort() : [],
      usedInComponents: used ? [...used.components].sort() : [],
      usedInWorkflows: used?.inWorkflows ?? false,
      schemaRequiredBy: schema ? [...schema.requiredBy].sort() : [],
      schemaOptionalBy: schema ? [...schema.optionalBy].sort() : [],
      manifestApps: manifest?.apps ?? [],
    });
  }
  return items;
}

function buildTag(item) {
  const requirement = item.required ? 'required' : 'optional';
  const timing = item.buildTime ? 'buildtime' : 'runtime';
  const visibility = item.secret ? 'secret' : 'public';
  return `# @env owner=${item.owner} ${requirement} ${timing} ${visibility} state=${item.state}`;
}

function tagFile(abs, itemByKey) {
  const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
  const headerLine = '# @env tag-format: owner=<component|shared|root|unknown> <required|optional> <runtime|buildtime> <secret|public> state=<active|stale|orphan|workflow-only>';
  const out = [];
  const hasHeader = lines.some((line) => line.trim() === headerLine);
  if (!hasHeader) {
    out.push(headerLine, '');
  }
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=.*$/);
    if (!m) {
      out.push(line);
      continue;
    }

    const key = m[1];
    const item = itemByKey.get(key);
    const tag = item ? buildTag(item) : '# @env owner=unknown optional runtime public state=unknown';
    if (out.length > 0 && out[out.length - 1].startsWith('# @env ')) {
      out.pop();
    }
    out.push(tag);
    out.push(line);
  }
  writeFileSync(abs, out.join('\n'));
}

function summarize(items) {
  const declared = items.filter((x) => x.declaredIn.length > 0);
  const stale = items.filter((x) => x.state === 'stale');
  const orphan = items.filter((x) => x.state === 'orphan');
  const workflowOnly = items.filter((x) => x.state === 'workflow-only');
  const required = items.filter((x) => x.required);
  return {
    totalKeys: items.length,
    declaredKeys: declared.length,
    requiredKeys: required.length,
    staleDeclaredKeys: stale.length,
    orphanUsedKeys: orphan.length,
    workflowOnlyKeys: workflowOnly.length,
    staleKeys: stale.map((x) => x.key),
    orphanKeys: orphan.map((x) => x.key),
    workflowKeys: workflowOnly.map((x) => x.key),
  };
}

function writeReport(report) {
  const repoReportDir = join(ROOT, 'reports', 'env');
  if (!existsSync(repoReportDir)) mkdirSync(repoReportDir, { recursive: true });
  const outPath = join(repoReportDir, 'inventory.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  return outPath;
}

function main() {
  const envFiles = getEnvFiles();
  const declarations = new Map();
  for (const file of envFiles) {
    for (const entry of parseEnvEntries(file)) {
      if (!declarations.has(entry.key)) declarations.set(entry.key, []);
      declarations.get(entry.key).push(file);
    }
  }

  const usage = scanEnvUsage();
  const manifestMeta = parseManifest();
  const schemaMeta = parseSchemaRequirements();
  const inventory = classify(declarations, usage, schemaMeta, manifestMeta);
  const summary = summarize(inventory);

  const report = {
    generatedAt: new Date().toISOString(),
    root: ROOT,
    summary,
    filesTagged: envFiles.map(rel),
    inventory,
  };

  const outPath = writeReport(report);

  if (WRITE_TAGS) {
    const itemByKey = new Map(inventory.map((item) => [item.key, item]));
    for (const file of envFiles) tagFile(file, itemByKey);
  }

  if (PRINT_JSON) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Inventory report: ${rel(outPath)}`);
  console.log(`Total keys: ${summary.totalKeys}`);
  console.log(`Declared keys: ${summary.declaredKeys}`);
  console.log(`Required keys: ${summary.requiredKeys}`);
  console.log(`Stale declared keys: ${summary.staleDeclaredKeys}`);
  console.log(`Orphan used keys: ${summary.orphanUsedKeys}`);
  console.log(`Workflow-only keys: ${summary.workflowOnlyKeys}`);
  if (summary.staleKeys.length) console.log(`Stale: ${summary.staleKeys.join(', ')}`);
  if (summary.orphanKeys.length) console.log(`Orphan: ${summary.orphanKeys.join(', ')}`);
  if (summary.workflowKeys.length) console.log(`Workflow-only: ${summary.workflowKeys.join(', ')}`);
  if (WRITE_TAGS) console.log('Tag comments written to .env and .env.example files.');
}

main();
