/**
 * Razorpay Setup Command
 *
 * Creates Razorpay subscription plans for all tiers and billing cycles,
 * then writes the resulting plan IDs to:
 *   1. MongoDB subscriptionPlans collection (immediate effect)
 *   2. src/data/default-data.ts (so every future `reset` includes the IDs)
 *
 * Idempotent: skips plans that already have a Razorpay ID set in MongoDB.
 * Use --force to overwrite existing IDs.
 *
 * Usage:
 *   npm run razorpay:setup --filter=@restropulse/db-cli
 *   npm run razorpay:setup --filter=@restropulse/db-cli -- --dry-run
 *   npm run razorpay:setup --filter=@restropulse/db-cli -- --force
 *   npm run razorpay:setup:main --filter=@restropulse/db-cli
 */

import chalk from 'chalk';
import ora from 'ora';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { connect, getConfig, disconnect } from '../config/database.js';
import { getResolvedEnv } from '../lib/env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAN_IDS_PATH = resolve(__dirname, '../data/razorpay-plan-ids.json');

interface RazorpaySetupOptions {
    dryRun?: boolean;
    force?: boolean;
}

interface PlanDefinition {
    slug: string;
    cycle: 'monthly' | 'annual';
    dbId: string;
    razorpayName: string;
    period: 'monthly' | 'yearly';
    interval: number;
    amountPaise: number;
}

const PLAN_DEFINITIONS: PlanDefinition[] = [
    {
        slug: 'starter',
        cycle: 'monthly',
        dbId: 'plan-starter-v1',
        razorpayName: 'RestroPulse Starter - Monthly',
        period: 'monthly',
        interval: 1,
        amountPaise: 299900,
    },
    {
        slug: 'starter',
        cycle: 'annual',
        dbId: 'plan-starter-v1',
        razorpayName: 'RestroPulse Starter - Annual',
        period: 'yearly',
        interval: 1,
        amountPaise: 2999000,
    },
    {
        slug: 'growth',
        cycle: 'monthly',
        dbId: 'plan-growth-v1',
        razorpayName: 'RestroPulse Growth - Monthly',
        period: 'monthly',
        interval: 1,
        amountPaise: 999900,
    },
    {
        slug: 'growth',
        cycle: 'annual',
        dbId: 'plan-growth-v1',
        razorpayName: 'RestroPulse Growth - Annual',
        period: 'yearly',
        interval: 1,
        amountPaise: 9999000,
    },
    {
        slug: 'premium',
        cycle: 'monthly',
        dbId: 'plan-premium-v1',
        razorpayName: 'RestroPulse Premium - Monthly',
        period: 'monthly',
        interval: 1,
        amountPaise: 1699900,
    },
    {
        slug: 'premium',
        cycle: 'annual',
        dbId: 'plan-premium-v1',
        razorpayName: 'RestroPulse Premium - Annual',
        period: 'yearly',
        interval: 1,
        amountPaise: 16999000,
    },
];

function buildPlanDescription(limits: Record<string, Record<string, number>>, cycle: 'monthly' | 'annual'): string {
    const parts: string[] = [];
    for (const [platform, typeLimits] of Object.entries(limits)) {
        const items = Object.entries(typeLimits)
            .filter(([, v]) => v > 0)
            .map(([type, limit]) => `${limit} ${type}`);
        if (items.length > 0) {
            parts.push(`${platform}: ${items.join(', ')} per week`);
        }
    }
    const base = parts.join('; ');
    return cycle === 'annual' ? `${base} (annual billing)` : base;
}

function getAuthHeader(keyId: string, keySecret: string): string {
    return 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
}

async function createRazorpayPlan(
    plan: PlanDefinition,
    keyId: string,
    keySecret: string,
    description: string,
): Promise<string> {
    const response = await fetch('https://api.razorpay.com/v1/plans', {
        method: 'POST',
        headers: {
            Authorization: getAuthHeader(keyId, keySecret),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            period: plan.period,
            interval: plan.interval,
            item: {
                name: plan.razorpayName,
                amount: plan.amountPaise,
                currency: 'INR',
                description: description,
            },
            notes: {
                slug: plan.slug,
                cycle: plan.cycle,
                db_id: plan.dbId,
            },
        }),
    });

    const data = await response.json() as any;

    if (!response.ok) {
        const msg = data?.error?.description || data?.message || `HTTP ${response.status}`;
        throw new Error(`Razorpay plan creation failed: ${msg}`);
    }

    return data.id as string;
}

/**
 * Updates razorpay-plan-ids.json for the given environment and plan.
 * Idempotent — safe to call multiple times.
 */
function patchRazorpayPlanIds(
    env: string,
    dbId: string,
    cycle: 'monthly' | 'annual',
    razorpayId: string,
): void {
    const raw = readFileSync(PLAN_IDS_PATH, 'utf-8');
    const data = JSON.parse(raw);
    if (!data[env]) data[env] = {};
    if (!data[env][dbId]) data[env][dbId] = { monthly: '', annual: '' };
    data[env][dbId][cycle] = razorpayId;
    writeFileSync(PLAN_IDS_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export async function razorpaySetupCommand(options: RazorpaySetupOptions): Promise<void> {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    const env = getResolvedEnv();

    if (!keyId || !keySecret) {
        console.error(chalk.red(`Error: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set in apps/db-cli/.env.${env}`));
        process.exit(1);
    }

    const dbConfig = getConfig();
    const dbName = dbConfig.database;
    const spinner = ora();

    console.log(chalk.cyan(`\nTarget database: ${chalk.bold(dbName)}`));
    console.log(chalk.cyan(`Target environment: ${chalk.bold(env)}`));
    if (options.dryRun) {
        console.log(chalk.yellow('Dry-run mode -- no API calls, DB writes, or file changes\n'));
    }
    if (options.force) {
        console.log(chalk.yellow('Force mode -- existing Razorpay plan IDs will be overwritten\n'));
    }

    try {
        spinner.start('Connecting to MongoDB...');
        const client = await connect();
        spinner.succeed('Connected to MongoDB');

        const db = client.db(dbName);
        const plansCol = db.collection('subscriptionPlans');

        // Print plan table
        console.log(chalk.cyan('\nPlans to create:'));
        console.log(chalk.gray('  Slug       Cycle    Amount (INR)  Razorpay Period'));
        console.log(chalk.gray('  ---------  -------  ------------  ---------------'));
        for (const plan of PLAN_DEFINITIONS) {
            const amountInr = (plan.amountPaise / 100).toLocaleString('en-IN');
            console.log(chalk.gray(`  ${plan.slug.padEnd(9)}  ${plan.cycle.padEnd(7)}  ${amountInr.padStart(12)}  ${plan.period}/${plan.interval}`));
        }
        console.log('');

        const results: { plan: PlanDefinition; razorpayId: string; action: string }[] = [];

        for (const plan of PLAN_DEFINITIONS) {
            const label = `${plan.slug} (${plan.cycle})`;
            spinner.start(`Processing ${label}...`);

            // Fetch current DB doc
            const dbDoc = await plansCol.findOne({ _id: plan.dbId as any, isCurrentVersion: true });

            if (!dbDoc) {
                spinner.warn(`${label}: DB document not found (id: ${plan.dbId}) -- run reset first`);
                continue;
            }

            const existingId: string = plan.cycle === 'monthly'
                ? dbDoc.razorpayPlanIds?.monthly
                : dbDoc.razorpayPlanIds?.annual;

            if (existingId && !options.force) {
                spinner.succeed(`${label}: already set (${existingId}) -- skipped`);
                results.push({ plan, razorpayId: existingId, action: 'skipped' });
                continue;
            }

            if (options.dryRun) {
                spinner.succeed(`${label}: would create Razorpay plan (dry-run)`);
                results.push({ plan, razorpayId: '(dry-run)', action: 'would-create' });
                continue;
            }

            // Create plan in Razorpay
            let razorpayId: string;
            try {
                const weeklyLimits = (dbDoc.limits?.weekly || {}) as Record<string, Record<string, number>>;
                const description = buildPlanDescription(weeklyLimits, plan.cycle);
                razorpayId = await createRazorpayPlan(plan, keyId, keySecret, description);
            } catch (err: any) {
                spinner.fail(`${label}: ${err.message}`);
                continue;
            }

            // Write ID back to MongoDB
            const field = plan.cycle === 'monthly'
                ? 'razorpayPlanIds.monthly'
                : 'razorpayPlanIds.annual';

            await plansCol.updateOne(
                { _id: plan.dbId as any },
                { $set: { [field]: razorpayId, updatedAt: new Date() } },
            );

            spinner.succeed(`${label}: created ${chalk.green(razorpayId)}`);
            results.push({ plan, razorpayId, action: 'created' });
        }

        // Patch razorpay-plan-ids.json for each newly created ID.
        const created = results.filter(r => r.action === 'created');

        if (created.length > 0) {
            spinner.start('Updating razorpay-plan-ids.json...');
            let patchCount = 0;
            for (const r of created) {
                try {
                    patchRazorpayPlanIds(env, r.plan.dbId, r.plan.cycle, r.razorpayId);
                    patchCount++;
                } catch (err: any) {
                    spinner.warn(`Could not update razorpay-plan-ids.json for ${r.plan.slug} ${r.plan.cycle}: ${err.message}`);
                }
            }
            spinner.succeed(`Updated razorpay-plan-ids.json (${patchCount} ID(s) written for env: ${env})`);
        }

        // Summary
        const skipped = results.filter(r => r.action === 'skipped');
        const wouldCreate = results.filter(r => r.action === 'would-create');

        console.log(chalk.cyan('\n--- Summary ---'));
        if (options.dryRun) {
            console.log(chalk.yellow(`  Would create: ${wouldCreate.length}`));
            console.log(chalk.gray(`  Already set (would skip): ${skipped.length}`));
        } else {
            console.log(chalk.green(`  Created: ${created.length}`));
            console.log(chalk.gray(`  Skipped (already set): ${skipped.length}`));
        }

        if (created.length > 0) {
            console.log(chalk.cyan('\n--- Razorpay Plan IDs ---'));
            for (const r of created) {
                console.log(chalk.gray(`  ${r.plan.slug} ${r.plan.cycle}: ${chalk.white(r.razorpayId)}`));
            }
            console.log(chalk.green('\nRazorpay setup complete.'));
            console.log(chalk.gray('  - Plan IDs saved to MongoDB'));
            console.log(chalk.gray(`  - razorpay-plan-ids.json updated for env: ${env}`));
            console.log(chalk.gray('  - Commit razorpay-plan-ids.json to share IDs with the team'));
        } else if (!options.dryRun) {
            console.log(chalk.gray('\nNo new plans created. All IDs already set.'));
        }

    } catch (err: any) {
        spinner.fail('Razorpay setup failed');
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
    } finally {
        await disconnect();
    }
}
