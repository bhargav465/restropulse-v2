/**
 * Environment resolution, .env loading, and confirmation guards for the db-cli.
 *
 * All commands import from here -- this is the single source of truth for which
 * environment is active and what credentials are loaded.
 */

import { config } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { createInterface } from 'readline/promises';
import { stdin, stdout } from 'process';
import chalk from 'chalk';
import { createSecretsProvider, hydrateEnvFromProvider, DB_CLI_SECRET_KEYS } from '@restropulse/secrets';

const VALID_ENVS = ['development', 'staging', 'production'] as const;
type ResolvedEnv = typeof VALID_ENVS[number];

let resolvedEnv: ResolvedEnv | null = null;

export function getResolvedEnv(): ResolvedEnv {
    if (!resolvedEnv) {
        throw new Error('loadEnv() must be called before getResolvedEnv()');
    }
    return resolvedEnv;
}

/** Redact credentials from a MongoDB URI for safe display. */
export function redactUri(uri: string): string {
    try {
        const parsed = new URL(uri);
        return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch {
        return '***';
    }
}

/**
 * Candidate base directories where apps/db-cli may be located,
 * searched in order based on common CWD locations.
 */
function getDbCliDirCandidates(): string[] {
    return [
        resolve(process.cwd(), 'apps/db-cli'),
        resolve(process.cwd(), '../db-cli'),
        resolve(process.cwd()),
    ];
}

/**
 * Load environment variables from the correct .env file for the given env.
 * Strict: only loads from apps/db-cli/.env.<env> files. No fallback to apps/api/.env.
 * Fails fast with a clear message if the required file is not found.
 *
 * Resolution order:
 *   staging / production: apps/db-cli/.env.<env>  (fail if missing)
 *   development:          apps/db-cli/.env.development  then  apps/db-cli/.env  (fail if neither)
 *
 * Uses override: false so shell env vars take precedence (CI-safe).
 */
export async function loadEnv(env: string): Promise<void> {
    const normalized = env.trim().toLowerCase() as ResolvedEnv;

    if (!VALID_ENVS.includes(normalized)) {
        console.error(chalk.red(`\n  Error: --env must be one of: ${VALID_ENVS.join(', ')}. Got: "${env}"`));
        process.exit(1);
    }

    const dirs = getDbCliDirCandidates();

    if (normalized === 'development') {
        // Try .env.development first, then .env
        const candidates = [
            ...dirs.map(d => resolve(d, '.env.development')),
            ...dirs.map(d => resolve(d, '.env')),
        ];
        const found = candidates.find(existsSync);
        if (!found) {
            console.error(chalk.red('\n  Error: No .env file found for development.'));
            console.error(chalk.yellow('  Create apps/db-cli/.env by copying apps/db-cli/.env.example and filling in values.\n'));
            process.exit(1);
        }
        config({ path: found, override: false });
    } else {
        // staging / production: only .env.<env>
        const candidates = dirs.map(d => resolve(d, `.env.${normalized}`));
        const found = candidates.find(existsSync);
        if (!found) {
            console.error(chalk.red(`\n  Error: No .env.${normalized} file found.`));
            console.error(chalk.yellow(`  Create apps/db-cli/.env.${normalized} by copying apps/db-cli/.env.${normalized}.example and filling in values.\n`));
            process.exit(1);
        }
        config({ path: found, override: false });
    }

    if (process.env.SECRETS_BACKEND) {
        await hydrateEnvFromProvider(
            createSecretsProvider(process.env.SECRETS_BACKEND),
            DB_CLI_SECRET_KEYS,
        );
    }

    process.env.NODE_ENV = normalized;
    resolvedEnv = normalized;
}

/**
 * For destructive commands targeting staging or production: require the operator
 * to type the environment name before proceeding. No-op on development.
 */
export async function requireNonDevConfirmation(command: string): Promise<void> {
    const env = getResolvedEnv();
    if (env === 'development') return;

    const envColor = env === 'production' ? chalk.red.bold : chalk.yellow.bold;
    const uri = process.env.MONGODB_URI;
    const db = process.env.MONGODB_DB_NAME;

    console.log(envColor(`\n  !! TARGETING ${env.toUpperCase()} !!`));
    console.log(chalk.white(`  Command  : ${command}`));
    console.log(chalk.white(`  MongoDB  : ${uri ? redactUri(uri) : chalk.red('(MONGODB_URI not set)')}`));
    console.log(chalk.white(`  Database : ${db ?? chalk.red('(MONGODB_DB_NAME not set)')}`));
    console.log('');

    const rl = createInterface({ input: stdin, output: stdout });
    const answer = await rl.question(
        chalk.white(`  Type "${env}" to confirm (or Ctrl+C to cancel): `),
    );
    rl.close();

    if (answer.trim() !== env) {
        console.log(chalk.gray('\n  Cancelled.'));
        process.exit(0);
    }
    console.log('');
}
