import chalk from 'chalk';
import ora from 'ora';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { connect, getConfig, promptForConnection, disconnect } from '../config/database.js';
import { getResolvedEnv, requireNonDevConfirmation } from '../lib/env.js';
import { COLLECTIONS } from '../schemas/collections.js';
import {
    DEFAULT_CITIES,
    DEFAULT_ACCOUNT_MANAGERS,
    DEFAULT_SUBSCRIPTION_PLANS,
    DEFAULT_CREDIT_PACKS,
} from '../data/default-data.js';

interface ResetOptions {
    allowMissingRazorpay?: boolean;
}

export async function resetCommand(options: ResetOptions): Promise<void> {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const PLAN_IDS_PATH = resolve(__dirname, '../data/razorpay-plan-ids.json');

    const env = getResolvedEnv();
    if (env !== 'development') {
        await requireNonDevConfirmation('reset');
    }

    const config = await promptForConnection();
    const spinner = ora();

    console.log(chalk.red.bold('\nWARNING: You are about to DROP and RECREATE the database!'));
    console.log(chalk.red(`All data in ${chalk.bold(config.database)} will be permanently deleted.`));
    console.log(chalk.gray('Press Ctrl+C to cancel.\n'));

    for (let i = 10; i > 0; i--) {
        process.stdout.write(chalk.yellow(`  Starting in ${i}...\r`));
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    process.stdout.write('\n');

    try {
        spinner.start('Connecting to MongoDB...');
        const client = await connect();
        spinner.succeed('Connected to MongoDB');

        const db = client.db(config.database);
        console.log(chalk.cyan(`\nResetting database: ${chalk.bold(config.database)}`));

        // Drop all known collections
        spinner.start('Dropping existing collections...');
        const existingCollections = await db.listCollections().toArray();
        const existingNames = existingCollections.map(c => c.name);

        for (const name of existingNames) {
            // Skip system collections
            if (name.startsWith('system.')) continue;
            await db.dropCollection(name);
            console.log(chalk.gray(`    Dropped: ${name}`));
        }
        spinner.succeed(`Dropped ${existingNames.filter(n => !n.startsWith('system.')).length} collection(s)`);

        // Recreate collections with validators and indexes
        for (const collection of COLLECTIONS) {
            spinner.start(`Creating collection: ${collection.name}`);

            await db.createCollection(collection.name, {
                validator: collection.validator,
                validationLevel: 'moderate',
                validationAction: 'warn',
            });

            const col = db.collection(collection.name);
            for (const index of collection.indexes) {
                await col.createIndex(index.spec, index.options || {});
            }

            spinner.succeed(`Created ${collection.name} (${collection.indexes.length} indexes)`);
        }

        // Seed default cities and HQ account managers
        spinner.start('Seeding default cities and account managers...');
        const now = new Date();
        const citiesCol = db.collection('cities');
        for (const city of DEFAULT_CITIES) {
            await citiesCol.insertOne({ ...city, createdAt: now, updatedAt: now } as any);
        }
        const amCol = db.collection('accountManagers');
        for (const am of DEFAULT_ACCOUNT_MANAGERS) {
            await amCol.insertOne({ ...am, createdAt: now, updatedAt: now } as any);
        }
        spinner.succeed(`Seeded ${DEFAULT_CITIES.length} cities and ${DEFAULT_ACCOUNT_MANAGERS.length} account managers`);

        // Load environment-specific Razorpay plan IDs
        let razorpayPlanIds: Record<string, { monthly: string; annual: string }> = {};
        try {
            const raw = readFileSync(PLAN_IDS_PATH, 'utf-8');
            const allEnvIds = JSON.parse(raw);
            razorpayPlanIds = allEnvIds[env] || allEnvIds['development'] || {};
        } catch {
            // File missing or unreadable — proceed with empty IDs from default-data
        }

        const missingRazorpay = DEFAULT_SUBSCRIPTION_PLANS
            .map((p) => {
                const ids = razorpayPlanIds[p._id];
                const missing = [
                    !ids?.monthly ? 'monthly' : null,
                    !ids?.annual ? 'annual' : null,
                ].filter(Boolean) as string[];
                return { id: p._id, name: p.name, missing };
            })
            .filter((r) => r.missing.length > 0);
        if (missingRazorpay.length > 0 && !options.allowMissingRazorpay) {
            spinner.fail('Reset aborted');
            console.error(chalk.red(`\nMissing Razorpay plan IDs for env "${env}".`));
            for (const r of missingRazorpay) {
                console.error(chalk.red(`  - ${r.id} (${r.name}): missing ${r.missing.join(', ')}`));
            }
            const scriptSuffix = env === 'development' ? '' : env === 'production' ? ':prod' : `:${env}`;
            console.error(chalk.yellow(`\nFix: run "npm run razorpay:setup${scriptSuffix} --workspace=@restropulse/db-cli"`));
            console.error(chalk.yellow('Or bypass once with "--allow-missing-razorpay" (not recommended).'));
            process.exit(1);
        }
        if (missingRazorpay.length > 0 && options.allowMissingRazorpay) {
            console.log(chalk.yellow(`\nProceeding with missing Razorpay plan IDs for env "${env}" because --allow-missing-razorpay was provided.`));
        }

        // Seed default subscription plans and credit packs
        spinner.start('Seeding default subscription plans and credit packs...');
        const plansCol = db.collection('subscriptionPlans');
        for (const plan of DEFAULT_SUBSCRIPTION_PLANS) {
            const envIds = razorpayPlanIds[plan._id];
            const razorpayPlanIdsResolved = envIds && (envIds.monthly || envIds.annual)
                ? envIds
                : plan.razorpayPlanIds;
            await plansCol.insertOne({ ...plan, razorpayPlanIds: razorpayPlanIdsResolved, createdAt: now, updatedAt: now } as any);
        }
        const packsCol = db.collection('creditPacks');
        for (const pack of DEFAULT_CREDIT_PACKS) {
            await packsCol.insertOne({ ...pack, createdAt: now, updatedAt: now } as any);
        }
        const hasIds = Object.values(razorpayPlanIds).some((ids: any) => ids.monthly || ids.annual);
        spinner.succeed(`Seeded ${DEFAULT_SUBSCRIPTION_PLANS.length} subscription plans and ${DEFAULT_CREDIT_PACKS.length} credit packs (env: ${env}${hasIds ? ', Razorpay IDs applied' : ', no Razorpay IDs set -- run razorpay:setup'})`);

        console.log(chalk.green('\nDatabase reset complete -- defaults seeded and ready to use.'));

    } catch (err: any) {
        spinner.fail('Reset failed');
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
    } finally {
        await disconnect();
    }
}
