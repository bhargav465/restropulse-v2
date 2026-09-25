import chalk from 'chalk';
import ora from 'ora';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { connect, getConfig, disconnect } from '../config/database.js';
import { getResolvedEnv, requireNonDevConfirmation } from '../lib/env.js';
import { SEED_DATA } from '../data/seedData.js';
import { COLLECTIONS } from '../schemas/collections.js';

type RazorpayPlanIds = { monthly: string; annual: string };

/**
 * Resolve a plan's Razorpay IDs when seeding, so a reseed never blanks them
 * (the seedData defaults ship empty). Precedence:
 *   1. env-specific IDs from razorpay-plan-ids.json (dev has these committed);
 *   2. the existing DB doc's non-empty IDs (protects staging/prod IDs that were
 *      written by `razorpay:setup` but are not in the JSON);
 *   3. the seedData default (empty) as a last resort.
 */
function resolveRazorpayPlanIds(
    jsonIds: RazorpayPlanIds | undefined,
    existingIds: RazorpayPlanIds | undefined,
    seedIds: RazorpayPlanIds | undefined,
): RazorpayPlanIds | undefined {
    if (jsonIds && (jsonIds.monthly || jsonIds.annual)) return jsonIds;
    if (existingIds && (existingIds.monthly || existingIds.annual)) return existingIds;
    return seedIds;
}

interface SeedOptions {
    clean?: boolean;
    allowMissingRazorpay?: boolean;
}

export async function seedCommand(options: SeedOptions): Promise<void> {
    if (options.clean) {
        const env = getResolvedEnv();
        if (env === 'development') {
            // 5-second countdown
            console.log(chalk.yellow('\n  WARNING: --clean will delete all existing data.\n'));
            for (let i = 5; i > 0; i--) {
                process.stdout.write(chalk.yellow(`  Proceeding in ${i}s... (Ctrl+C to cancel)\r`));
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
            console.log();
        } else {
            await requireNonDevConfirmation('seed --clean');
        }
    }

    const config = getConfig();
    const spinner = ora();

    try {
        spinner.start('Connecting to MongoDB...');
        const client = await connect();
        spinner.succeed('Connected to MongoDB');

        const db = client.db(config.database);
        console.log(chalk.cyan(`\nSeeding database: ${chalk.bold(config.database)}`));

        // Load environment-specific Razorpay plan IDs so reseeding preserves them
        // (mirrors the reset command; see resolveRazorpayPlanIds precedence).
        const env = getResolvedEnv();
        const PLAN_IDS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../data/razorpay-plan-ids.json');
        let razorpayPlanIdsByPlan: Record<string, RazorpayPlanIds> = {};
        try {
            const allEnvIds = JSON.parse(readFileSync(PLAN_IDS_PATH, 'utf-8'));
            razorpayPlanIdsByPlan = allEnvIds[env] || {};
        } catch {
            // File missing/unreadable -- treated as "no IDs" by the validation below
        }

        // Pre-seed validation: refuse to seed unless razorpay-plan-ids.json has a
        // complete (monthly + annual) ID for every subscription plan in this env.
        // This prevents seeding plans with blank Razorpay IDs, which silently
        // breaks /subscribe with "Razorpay plan not configured".
        // NOTE: a fresh environment has an empty JSON by design -- bootstrap it via
        // `reset` (creates the plan docs) then `razorpay:setup` (creates the
        // Razorpay plans and writes the IDs into this JSON), then re-run seed.
        const seedPlans = (SEED_DATA as Record<string, any[]>).subscriptionPlans ?? [];
        const missingRazorpay = seedPlans
            .filter((p) => p._id)
            .map((p) => {
                const ids = razorpayPlanIdsByPlan[p._id as string];
                const missing = [
                    !ids?.monthly ? 'monthly' : null,
                    !ids?.annual ? 'annual' : null,
                ].filter(Boolean) as string[];
                return { id: p._id as string, name: p.name as string, missing };
            })
            .filter((r) => r.missing.length > 0);

        if (missingRazorpay.length > 0 && !options.allowMissingRazorpay) {
            spinner.stop();
            console.error(chalk.red(`\nSeed aborted: missing Razorpay plan IDs for env "${env}".`));
            console.error(chalk.red('razorpay-plan-ids.json must define monthly + annual IDs for every plan:'));
            for (const r of missingRazorpay) {
                console.error(chalk.red(`  - ${r.id} (${r.name}): missing ${r.missing.join(', ')}`));
            }
            const scriptSuffix = env === 'development' ? '' : env === 'production' ? ':prod' : `:${env}`;
            console.error(chalk.yellow(`\nFix: run "npm run razorpay:setup${scriptSuffix} --workspace=@restropulse/db-cli"`));
            console.error(chalk.yellow('Or bypass once with "--allow-missing-razorpay" (not recommended).'));
            console.error(chalk.yellow('(for a brand-new environment, run reset first to create the plan docs).'));
            await disconnect();
            process.exit(1);
        }
        if (missingRazorpay.length > 0 && options.allowMissingRazorpay) {
            console.log(chalk.yellow(`\nProceeding with missing Razorpay plan IDs for env "${env}" because --allow-missing-razorpay was provided.`));
        }

        // Ensure indexes exist before seeding
        spinner.start('Ensuring indexes exist...');
        for (const schema of COLLECTIONS) {
            const col = db.collection(schema.name);
            for (const index of schema.indexes) {
                try {
                    await col.createIndex(index.spec, index.options || {});
                } catch (err: any) {
                    // Ignore "index already exists" errors
                    if (err.code !== 85 && err.code !== 86) {
                        console.log(chalk.yellow(`\n    Warning: Could not create index on ${schema.name}: ${err.message}`));
                    }
                }
            }
        }
        spinner.succeed('Indexes verified');

        if (options.clean) {
            spinner.start('Clearing existing data...');
            const collectionsToClear = Array.from(
                new Set([
                    ...COLLECTIONS.map((schema) => schema.name),
                    ...Object.keys(SEED_DATA),
                ]),
            );

            for (const collectionName of collectionsToClear) {
                try {
                    await db.collection(collectionName).deleteMany({});
                } catch (err) {
                    // Collection might not exist
                }
            }
            spinner.succeed('Cleared existing data');
        }

        // Seed each collection
        for (const [collectionName, documents] of Object.entries(SEED_DATA)) {
            if (!documents || documents.length === 0) continue;

            spinner.start(`Seeding: ${collectionName}`);

            try {
                const col = db.collection(collectionName);

                // Add timestamps
                const docsWithTimestamps = documents.map(doc => ({
                    ...doc,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }));

                // Use upsert to avoid duplicates
                for (const doc of docsWithTimestamps) {
                    if (doc._id) {
                        // For subscription plans, preserve Razorpay IDs across reseeds:
                        // seedData ships empty IDs, so a plain replace would blank the
                        // real IDs and break /subscribe. Resolve from JSON/existing DB.
                        let docToWrite: any = doc;
                        if (collectionName === 'subscriptionPlans') {
                            const existing = await col.findOne({ _id: doc._id } as any);
                            docToWrite = {
                                ...doc,
                                razorpayPlanIds: resolveRazorpayPlanIds(
                                    razorpayPlanIdsByPlan[doc._id as string],
                                    (existing as any)?.razorpayPlanIds,
                                    (doc as any).razorpayPlanIds,
                                ),
                            };
                        }
                        await col.replaceOne(
                            { _id: doc._id },
                            docToWrite,
                            { upsert: true }
                        );
                    } else {
                        await col.insertOne(doc);
                    }
                }

                spinner.succeed(`Seeded ${collectionName}: ${documents.length} document(s)`);
            } catch (err: any) {
                spinner.fail(`Failed to seed ${collectionName}: ${err.message}`);
            }
        }

        console.log(chalk.green('\nSeeding complete!'));

        // Show summary
        console.log(chalk.cyan('\n--- Data Summary ---'));
        for (const [collectionName] of Object.entries(SEED_DATA)) {
            const count = await db.collection(collectionName).countDocuments();
            console.log(chalk.gray(`  ${collectionName}: ${count} documents`));
        }

    } catch (err: any) {
        spinner.fail('Seeding failed');
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
    } finally {
        await disconnect();
    }
}
