import { MongoClient, Db } from 'mongodb';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import chalk from 'chalk';
import { redactUri, getResolvedEnv } from '../lib/env.js';

export { getResolvedEnv } from '../lib/env.js';

export interface DatabaseConfig {
    uri: string;
    database: string;
}

export function getConfig(): DatabaseConfig {
    const uri = process.env.MONGODB_URI;
    const database = process.env.MONGODB_DB_NAME;

    if (!uri) {
        console.error(chalk.red('Error: MONGODB_URI environment variable is not set'));
        process.exit(1);
    }

    if (!database) {
        console.error(chalk.red('Error: MONGODB_DB_NAME environment variable is not set'));
        process.exit(1);
    }

    return {
        uri,
        database,
    };
}

/**
 * Interactively prompt for MongoDB connection details.
 * Shows current env values as defaults; press Enter to keep them.
 * Updates process.env so subsequent getConfig() and connect() calls
 * use the values entered here.
 */
export async function promptForConnection(): Promise<DatabaseConfig> {
    const rl = createInterface({ input, output });

    const currentUri = process.env.MONGODB_URI;
    const currentDb = process.env.MONGODB_DB_NAME || 'restropulse';

    console.log(chalk.cyan('\nDatabase connection'));
    console.log(chalk.gray('Press Enter to keep the current value shown in brackets.\n'));

    // URI — show redacted hint so credentials are not echoed back in full
    const uriHint = currentUri
        ? chalk.gray(`[currently set — ${redactUri(currentUri)}]`)
        : chalk.yellow('[not set]');
    const uriInput = await rl.question(`  MongoDB URI ${uriHint}: `);
    const resolvedUri = uriInput.trim() || currentUri || '';

    if (!resolvedUri) {
        console.error(chalk.red('\nError: MongoDB URI is required'));
        rl.close();
        process.exit(1);
    }

    // DB name — show full current value as default
    const dbInput = await rl.question(`  Database name [${currentDb}]: `);
    const resolvedDb = dbInput.trim() || currentDb;

    rl.close();

    // Apply to env so connect() and getConfig() pick them up
    process.env.MONGODB_URI = resolvedUri;
    process.env.MONGODB_DB_NAME = resolvedDb;

    console.log(chalk.gray(`\n  Target: ${redactUri(resolvedUri)} / ${chalk.bold(resolvedDb)}`));
    console.log(chalk.gray(`  Environment: ${getResolvedEnv()}\n`));

    return { uri: resolvedUri, database: resolvedDb };
}

let client: MongoClient | null = null;

export async function connect(): Promise<MongoClient> {
    if (client) return client;

    const config = getConfig();
    client = new MongoClient(config.uri);
    await client.connect();
    return client;
}

export async function getDatabase(): Promise<Db> {
    const mongoClient = await connect();
    const config = getConfig();
    return mongoClient.db(config.database);
}

export async function disconnect(): Promise<void> {
    if (client) {
        await client.close();
        client = null;
    }
}
