import chalk from 'chalk';
import ora from 'ora';
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { randomBytes } from 'crypto';
import { execFileSync } from 'child_process';
import { MongoClient, type Document, type Db } from 'mongodb';
import { connect, getConfig, disconnect } from '../config/database.js';
import { getResolvedEnv, requireNonDevConfirmation } from '../lib/env.js';
import { COLLECTIONS } from '../schemas/collections.js';

const SYSTEM_DBS = new Set(['admin', 'local', 'config']);
const TARGET_DBS = ['restropulse_dev', 'restropulse_staging', 'restropulse_prod'] as const;

interface InventoryOptions {
  output?: string;
}

interface BackupOptions {
  output?: string;
  execute?: boolean;
}

interface ProvisionOptions {
  output?: string;
  execute?: boolean;
  vaultName?: string;
  confirm?: string;
}

interface ValidateOptions {
  input?: string;
}

interface CleanupOptions {
  input?: string;
  execute?: boolean;
  confirm?: string;
}

interface UserSpec {
  username: string;
  role: string;
  roleDb: string;
  targetDb: string;
  secretName: string;
}

interface ProvisionMetadata {
  generatedAt: string;
  vaultName: string;
  users: UserSpec[];
  superAdmin: {
    username: string;
    secretName: string;
  };
  roles: Array<{
    role: string;
    db: string;
    inheritedRole: string;
    inheritedDb: string;
  }>;
  targetDatabases: string[];
}

function ensureReportsDir(): string {
  const dir = resolve(process.cwd(), 'reports', 'atlas');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function ts(): string {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function buildBackupDbName(sourceDb: string, stamp: string): string {
  const raw = `backup_${sourceDb}_${stamp}`;
  if (raw.length <= 38) return raw;

  const compactStamp = stamp.replace('-', '');
  const prefix = `bkp_${compactStamp}_`;
  const remaining = 38 - prefix.length;
  const normalized = sourceDb.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${prefix}${normalized.slice(0, Math.max(1, remaining))}`;
}

function writeLatestAlias(prefix: string, generatedPath: string): void {
  const dir = ensureReportsDir();
  const aliasPath = resolve(dir, `${prefix}-latest.json`);
  const payload = readFileSync(generatedPath, 'utf8');
  writeFileSync(aliasPath, payload);
}

function latestReportByPrefix(prefix: string): string {
  const dir = ensureReportsDir();
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json') && !f.includes('-latest'))
    .sort()
    .reverse();
  if (files.length === 0) {
    throw new Error(`No report found for prefix "${prefix}" in ${dir}`);
  }
  return resolve(dir, files[0]);
}

function sanitizeUsers(usersRaw: any[]): any[] {
  return usersRaw.map((u) => ({
    user: u.user,
    db: u.db,
    roles: u.roles,
    customData: u.customData ?? null,
    inheritedRoles: u.inheritedRoles ?? [],
  }));
}

function getVaultNameFromUrl(vaultUrl: string | undefined): string {
  if (!vaultUrl) {
    throw new Error('AZURE_KEY_VAULT_URL is required (or pass --vault-name)');
  }
  const host = new URL(vaultUrl).hostname;
  const parts = host.split('.');
  if (parts.length < 1 || !parts[0]) {
    throw new Error(`Could not parse Key Vault name from URL: ${vaultUrl}`);
  }
  return parts[0];
}

async function confirmForExecute(command: string, confirmToken: string | undefined): Promise<void> {
  const env = getResolvedEnv();
  if (confirmToken && confirmToken.trim() === env) return;
  await requireNonDevConfirmation(command);
}

function setSecretInKv(vaultName: string, secretName: string, secretValue: string): void {
  execFileSync(
    'az',
    ['keyvault', 'secret', 'set', '--vault-name', vaultName, '--name', secretName, '--value', secretValue, '--output', 'none'],
    { stdio: 'pipe' },
  );
}

function injectMongoCredentials(uri: string, username: string, password: string): string {
  const encodedUser = encodeURIComponent(username);
  const encodedPass = encodeURIComponent(password);
  return uri.replace(
    /^mongodb(\+srv)?:\/\/(?:[^@/]+@)?/i,
    `mongodb$1://${encodedUser}:${encodedPass}@`,
  );
}

async function getAllDatabases(client: MongoClient): Promise<Array<{ name: string; sizeOnDisk?: number; empty?: boolean }>> {
  const adminDb = client.db('admin');
  const result = await adminDb.admin().listDatabases({ nameOnly: false });
  return (result.databases ?? []).map((db: any) => ({
    name: db.name,
    sizeOnDisk: db.sizeOnDisk,
    empty: db.empty,
  }));
}

async function getAllUsers(client: MongoClient): Promise<any[]> {
  const adminDb = client.db('admin');
  try {
    const out = await adminDb.command({ usersInfo: 1, forAllDBs: true, showPrivileges: false });
    return out.users ?? [];
  } catch {
    // Fallback: dbs + usersInfo per db if forAllDBs is not available by role/server.
    const dbs = await getAllDatabases(client);
    const users: any[] = [];
    for (const db of dbs) {
      try {
        const info = await client.db(db.name).command({ usersInfo: 1, showPrivileges: false });
        users.push(...(info.users ?? []));
      } catch {
        // best-effort per DB
      }
    }
    return users;
  }
}

async function cloneDatabase(client: MongoClient, sourceDbName: string, targetDbName: string): Promise<{
  sourceDb: string;
  targetDb: string;
  collections: Array<{ name: string; sourceCount: number; targetCount: number; copiedIndexes: number }>;
}> {
  const sourceDb = client.db(sourceDbName);
  const targetDb = client.db(targetDbName);
  const collections = await sourceDb.listCollections({}, { nameOnly: false }).toArray();

  const collectionResults: Array<{ name: string; sourceCount: number; targetCount: number; copiedIndexes: number }> = [];

  for (const collInfo of collections) {
    const collName = collInfo.name;
    const sourceCol = sourceDb.collection(collName);

    const targetExists = await targetDb.listCollections({ name: collName }).toArray();
    if (targetExists.length > 0) {
      await targetDb.collection(collName).drop();
    }

    const createOptions: Document = {};
    if (collInfo.options?.validator) createOptions.validator = collInfo.options.validator;
    if (collInfo.options?.validationLevel) createOptions.validationLevel = collInfo.options.validationLevel;
    if (collInfo.options?.validationAction) createOptions.validationAction = collInfo.options.validationAction;
    await targetDb.createCollection(collName, createOptions);

    const cursor = sourceCol.find({});
    const batchSize = 1000;
    let batch: Document[] = [];
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      if (!doc) continue;
      batch.push(doc);
      if (batch.length >= batchSize) {
        await targetDb.collection(collName).insertMany(batch, { ordered: false });
        batch = [];
      }
    }
    if (batch.length > 0) {
      await targetDb.collection(collName).insertMany(batch, { ordered: false });
    }

    const indexes = await sourceCol.indexes();
    const indexSpecs = indexes
      .filter((idx) => idx.name !== '_id_')
      .map((idx) => {
        const spec: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(idx as Record<string, unknown>)) {
          if (k === 'ns' || k === 'v') continue;
          if (v === null || v === undefined) continue;
          spec[k] = v;
        }
        return spec;
      });
    if (indexSpecs.length > 0) {
      await targetDb.collection(collName).createIndexes(indexSpecs as any);
    }

    const sourceCount = await sourceCol.estimatedDocumentCount();
    const targetCount = await targetDb.collection(collName).estimatedDocumentCount();
    collectionResults.push({
      name: collName,
      sourceCount,
      targetCount,
      copiedIndexes: indexSpecs.length,
    });
  }

  return { sourceDb: sourceDbName, targetDb: targetDbName, collections: collectionResults };
}

async function ensureTargetSchemas(client: MongoClient): Promise<void> {
  for (const dbName of TARGET_DBS) {
    const db = client.db(dbName);

    for (const schema of COLLECTIONS) {
      const exists = await db.listCollections({ name: schema.name }).toArray();
      if (exists.length === 0) {
        await db.createCollection(schema.name, {
          validator: schema.validator,
          validationLevel: 'moderate',
          validationAction: 'warn',
        });
      } else {
        await db.command({
          collMod: schema.name,
          validator: schema.validator,
          validationLevel: 'moderate',
          validationAction: 'warn',
        });
      }

      const col = db.collection(schema.name);
      for (const idx of schema.indexes) {
        try {
          await col.createIndex(idx.spec, idx.options ?? {});
        } catch (err: any) {
          if (err?.code !== 85) throw err;
        }
      }
    }
  }
}

async function roleExists(adminDb: Db, roleName: string): Promise<boolean> {
  try {
    const out = await adminDb.command({ rolesInfo: { role: roleName, db: 'admin' }, showPrivileges: false });
    return (out.roles ?? []).length > 0;
  } catch {
    return false;
  }
}

async function userExists(adminDb: Db, username: string): Promise<boolean> {
  try {
    const out = await adminDb.command({ usersInfo: { user: username, db: 'admin' } });
    return (out.users ?? []).length > 0;
  } catch {
    return false;
  }
}

function buildProvisionMetadata(vaultName: string): ProvisionMetadata {
  const envMap = [
    { key: 'dev', db: 'restropulse_dev' },
    { key: 'staging', db: 'restropulse_staging' },
    { key: 'prod', db: 'restropulse_prod' },
  ] as const;

  const users: UserSpec[] = [];
  const roles: ProvisionMetadata['roles'] = [];

  for (const e of envMap) {
    const role = `role_${e.db}`;
    roles.push({
      role,
      db: 'admin',
      inheritedRole: 'readWrite',
      inheritedDb: e.db,
    });
    users.push(
      {
        username: `rp_${e.key}_app`,
        role,
        roleDb: 'admin',
        targetDb: e.db,
        secretName: `${e.key}-mongo-user-rp-${e.key}-app-password`,
      },
      {
        username: `rp_${e.key}_ops`,
        role,
        roleDb: 'admin',
        targetDb: e.db,
        secretName: `${e.key}-mongo-user-rp-${e.key}-ops-password`,
      },
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    vaultName,
    users,
    superAdmin: {
      username: 'rp_super_admin',
      secretName: 'prod-mongo-superadmin-password',
    },
    roles,
    targetDatabases: [...TARGET_DBS],
  };
}

export async function atlasInventoryCommand(options: InventoryOptions): Promise<void> {
  const spinner = ora();
  try {
    spinner.start('Connecting to MongoDB Atlas...');
    const client = await connect();
    spinner.succeed('Connected');

    spinner.start('Collecting database inventory...');
    const databases = await getAllDatabases(client);
    spinner.succeed(`Found ${databases.length} database(s)`);

    spinner.start('Collecting users and roles...');
    const users = await getAllUsers(client);
    spinner.succeed(`Found ${users.length} user(s)`);

    const report = {
      generatedAt: new Date().toISOString(),
      environment: getResolvedEnv(),
      cluster: getConfig().uri,
      databases,
      users: sanitizeUsers(users),
    };

    const outPath = options.output ?? resolve(ensureReportsDir(), `atlas-inventory-${ts()}.json`);
    writeFileSync(outPath, JSON.stringify(report, null, 2));
    writeLatestAlias('atlas-inventory', outPath);
    console.log(chalk.green(`\nInventory report written: ${outPath}`));
  } catch (err: any) {
    spinner.fail('Atlas inventory failed');
    console.error(chalk.red(err.message));
    process.exit(1);
  } finally {
    await disconnect();
  }
}

export async function atlasBackupCloneCommand(options: BackupOptions): Promise<void> {
  const spinner = ora();
  const execute = options.execute === true;
  const stamp = ts();
  try {
    if (!execute) {
      console.log(chalk.yellow('\nDry-run mode. Use --execute to perform cloning.\n'));
    }

    spinner.start('Connecting to MongoDB Atlas...');
    const client = await connect();
    spinner.succeed('Connected');

    const dbs = await getAllDatabases(client);
    const eligible = dbs
      .map((d) => d.name)
      .filter((n) => !SYSTEM_DBS.has(n))
      .filter((n) => !n.startsWith('backup_'))
      .filter((n) => !n.startsWith('bkp_'))
      .filter((n) => !TARGET_DBS.includes(n as any));

    if (eligible.length === 0) {
      console.log(chalk.yellow('No eligible databases found for backup cloning.'));
      return;
    }

    const manifest: any = {
      generatedAt: new Date().toISOString(),
      execute,
      sourceDatabases: eligible,
      backups: [] as any[],
    };

    for (const sourceDb of eligible) {
      const targetDb = buildBackupDbName(sourceDb, stamp);
      if (!execute) {
        manifest.backups.push({ sourceDb, targetDb, status: 'would-clone' });
        continue;
      }

      spinner.start(`Cloning ${sourceDb} -> ${targetDb} ...`);
      const result = await cloneDatabase(client, sourceDb, targetDb);
      spinner.succeed(`Cloned ${sourceDb} -> ${targetDb}`);
      manifest.backups.push({ ...result, status: 'cloned' });
    }

    const outPath = options.output ?? resolve(ensureReportsDir(), `atlas-backup-manifest-${stamp}.json`);
    writeFileSync(outPath, JSON.stringify(manifest, null, 2));
    writeLatestAlias('atlas-backup-manifest', outPath);
    console.log(chalk.green(`\nBackup manifest written: ${outPath}`));
  } catch (err: any) {
    spinner.fail('Atlas backup clone failed');
    console.error(chalk.red(err.message));
    process.exit(1);
  } finally {
    await disconnect();
  }
}

export async function atlasProvisionCommand(options: ProvisionOptions): Promise<void> {
  const spinner = ora();
  const execute = options.execute === true;
  const vaultName = options.vaultName || getVaultNameFromUrl(process.env.AZURE_KEY_VAULT_URL);
  const metadata = buildProvisionMetadata(vaultName);

  try {
    if (!execute) {
      console.log(chalk.yellow('\nDry-run mode. Use --execute to create DBs/roles/users and store credentials in AKV.\n'));
    } else {
      await confirmForExecute('atlas-provision', options.confirm);
    }

    spinner.start('Connecting to MongoDB Atlas...');
    const client = await connect();
    spinner.succeed('Connected');
    const adminDb = client.db('admin');

    // Ensure target DB schemas exist.
    if (execute) {
      spinner.start('Ensuring target database schemas...');
      await ensureTargetSchemas(client);
      spinner.succeed('Target schemas ensured');
    }

    // Roles
    for (const role of metadata.roles) {
      if (!execute) continue;
      const exists = await roleExists(adminDb, role.role);
      if (exists) {
        await adminDb.command({
          updateRole: role.role,
          privileges: [],
          roles: [{ role: role.inheritedRole, db: role.inheritedDb }],
        });
      } else {
        await adminDb.command({
          createRole: role.role,
          privileges: [],
          roles: [{ role: role.inheritedRole, db: role.inheritedDb }],
        });
      }
    }

    // Scoped users
    for (const user of metadata.users) {
      const password = randomBytes(24).toString('base64url');
      if (execute) {
        setSecretInKv(vaultName, user.secretName, password);
        const exists = await userExists(adminDb, user.username);
        if (exists) {
          await adminDb.command({
            updateUser: user.username,
            pwd: password,
            roles: [{ role: user.role, db: user.roleDb }],
          });
        } else {
          await adminDb.command({
            createUser: user.username,
            pwd: password,
            roles: [{ role: user.role, db: user.roleDb }],
          });
        }
      }
    }

    // Super admin
    const superPassword = randomBytes(28).toString('base64url');
    if (execute) {
      setSecretInKv(vaultName, metadata.superAdmin.secretName, superPassword);
      const exists = await userExists(adminDb, metadata.superAdmin.username);
      if (exists) {
        await adminDb.command({
          updateUser: metadata.superAdmin.username,
          pwd: superPassword,
          roles: [{ role: 'root', db: 'admin' }],
        });
      } else {
        await adminDb.command({
          createUser: metadata.superAdmin.username,
          pwd: superPassword,
          roles: [{ role: 'root', db: 'admin' }],
        });
      }
    }

    const outPath = options.output ?? resolve(ensureReportsDir(), `atlas-provision-metadata-${ts()}.json`);
    writeFileSync(outPath, JSON.stringify(metadata, null, 2));
    writeLatestAlias('atlas-provision-metadata', outPath);
    console.log(chalk.green(`\nProvision metadata written: ${outPath}`));
    console.log(chalk.gray('Metadata includes usernames/roles/secret names only (no plaintext passwords).'));
  } catch (err: any) {
    spinner.fail('Atlas provisioning failed');
    console.error(chalk.red(err.message));
    process.exit(1);
  } finally {
    await disconnect();
  }
}

export async function atlasValidateAccessCommand(options: ValidateOptions): Promise<void> {
  const spinner = ora();
  try {
    const input = options.input ?? latestReportByPrefix('atlas-provision-metadata');
    if (!existsSync(input)) {
      throw new Error(`Provision metadata not found: ${input}`);
    }
    const metadata = JSON.parse(readFileSync(input, 'utf8')) as ProvisionMetadata;
    const clusterUri = getConfig().uri;
    const results: any[] = [];

    const fetchSecret = (name: string): string =>
      execFileSync('az', ['keyvault', 'secret', 'show', '--vault-name', metadata.vaultName, '--name', name, '--query', 'value', '-o', 'tsv'], { encoding: 'utf8' }).trim();

    for (const user of metadata.users) {
      spinner.start(`Validating scoped user ${user.username} ...`);
      const pwd = fetchSecret(user.secretName);
      const uri = injectMongoCredentials(clusterUri, user.username, pwd);
      const c = new MongoClient(uri);
      try {
        await c.connect();
        const allowedDb = c.db(user.targetDb);
        await allowedDb.command({ ping: 1 });

        const deniedTargets = metadata.targetDatabases.filter((db) => db !== user.targetDb);
        const deniedChecks: Record<string, boolean> = {};
        for (const dbName of deniedTargets) {
          try {
            await c.db(dbName).command({ listCollections: 1, nameOnly: true });
            deniedChecks[dbName] = false;
          } catch {
            deniedChecks[dbName] = true;
          }
        }

        results.push({
          principal: user.username,
          type: 'scoped',
          targetDb: user.targetDb,
          canAccessTarget: true,
          deniedOtherDbs: deniedChecks,
          passed: Object.values(deniedChecks).every((v) => v),
        });
        spinner.succeed(`Validated scoped user ${user.username}`);
      } finally {
        await c.close();
      }
    }

    spinner.start('Validating super-admin principal...');
    const superPwd = fetchSecret(metadata.superAdmin.secretName);
    const superUri = injectMongoCredentials(clusterUri, metadata.superAdmin.username, superPwd);
    const superClient = new MongoClient(superUri);
    try {
      await superClient.connect();
      const dbs = await superClient.db('admin').admin().listDatabases({ nameOnly: true });
      const names = (dbs.databases ?? []).map((d: any) => d.name);
      const hasAllTargets = metadata.targetDatabases.every((db) => names.includes(db));
      results.push({
        principal: metadata.superAdmin.username,
        type: 'super-admin',
        hasAllTargets,
        passed: hasAllTargets,
      });
      spinner.succeed('Validated super-admin principal');
    } finally {
      await superClient.close();
    }

    const report = {
      generatedAt: new Date().toISOString(),
      sourceMetadata: input,
      results,
      passed: results.every((r) => r.passed),
    };
    const outPath = resolve(ensureReportsDir(), `atlas-access-validation-${ts()}.json`);
    writeFileSync(outPath, JSON.stringify(report, null, 2));
    writeLatestAlias('atlas-access-validation', outPath);
    console.log(chalk.green(`\nValidation report written: ${outPath}`));
    if (!report.passed) {
      console.log(chalk.red('Validation failed for one or more principals.'));
      process.exit(1);
    }
  } catch (err: any) {
    spinner.fail('Access validation failed');
    console.error(chalk.red(err.message));
    process.exit(1);
  }
}

export async function atlasCleanupLegacyCommand(options: CleanupOptions): Promise<void> {
  const spinner = ora();
  const execute = options.execute === true;
  try {
    const input = options.input ?? '';
    if (execute) {
      await confirmForExecute('atlas-cleanup-legacy', options.confirm);
    }

    spinner.start('Connecting to MongoDB Atlas...');
    const client = await connect();
    spinner.succeed('Connected');
    const adminDb = client.db('admin');

    const dbs = await getAllDatabases(client);
    const legacyDbs = dbs
      .map((d) => d.name)
      .filter((n) => !SYSTEM_DBS.has(n))
      .filter((n) => !TARGET_DBS.includes(n as any))
      .filter((n) => !n.startsWith('backup_'))
      .filter((n) => !n.startsWith('bkp_'));

    const users = await getAllUsers(client);
    const keepUsers = new Set([
      'rp_super_admin',
      'rp_dev_app',
      'rp_dev_ops',
      'rp_staging_app',
      'rp_staging_ops',
      'rp_prod_app',
      'rp_prod_ops',
    ]);
    const legacyUsers = users
      .filter((u) => u.db === 'admin')
      .map((u) => u.user as string)
      .filter((u) => !keepUsers.has(u));

    const report = {
      generatedAt: new Date().toISOString(),
      execute,
      sourceValidation: input || null,
      legacyDatabases: legacyDbs,
      legacyUsers,
    };

    if (!execute) {
      const outPath = resolve(ensureReportsDir(), `atlas-legacy-cleanup-dryrun-${ts()}.json`);
      writeFileSync(outPath, JSON.stringify(report, null, 2));
      writeLatestAlias('atlas-legacy-cleanup-dryrun', outPath);
      console.log(chalk.yellow(`\nDry-run cleanup report written: ${outPath}`));
      console.log(chalk.yellow('No users or databases were deleted.'));
      return;
    }

    for (const dbName of legacyDbs) {
      await client.db(dbName).dropDatabase();
    }
    for (const username of legacyUsers) {
      await adminDb.command({ dropUser: username });
    }

    const outPath = resolve(ensureReportsDir(), `atlas-legacy-cleanup-executed-${ts()}.json`);
    writeFileSync(outPath, JSON.stringify(report, null, 2));
    writeLatestAlias('atlas-legacy-cleanup-executed', outPath);
    console.log(chalk.green(`\nLegacy cleanup executed. Report: ${outPath}`));
  } catch (err: any) {
    spinner.fail('Legacy cleanup failed');
    console.error(chalk.red(err.message));
    process.exit(1);
  } finally {
    await disconnect();
  }
}
