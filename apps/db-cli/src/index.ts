#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { loadEnv, getResolvedEnv, redactUri } from './lib/env.js';
import { setupCommand } from './commands/setup.js';
import { validateCommand } from './commands/validate.js';
import { seedCommand } from './commands/seed.js';
import { resetCommand } from './commands/reset.js';
import { razorpaySetupCommand } from './commands/razorpay-setup.js';
import { deleteAccountCommand } from './commands/delete-account.js';
import { acquireRestaurantsCommand } from './commands/acquire-restaurants.js';
import {
    atlasInventoryCommand,
    atlasBackupCloneCommand,
    atlasProvisionCommand,
    atlasValidateAccessCommand,
    atlasCleanupLegacyCommand,
} from './commands/atlas-admin.js';

const program = new Command();

function printBanner(): void {
    const env = getResolvedEnv();
    const uri = process.env.MONGODB_URI;
    const db = process.env.MONGODB_DB_NAME;
    const envColor = env === 'production' ? chalk.red.bold
        : env === 'staging' ? chalk.yellow.bold
        : chalk.green;

    console.log(chalk.cyan.bold('\n  RestroPulse Database CLI'));
    console.log(`  Environment : ${envColor(env)}`);
    console.log(`  Database    : ${chalk.white(db ?? chalk.red('(not set)'))}`);
    if (uri) {
        console.log(`  MongoDB     : ${chalk.gray(redactUri(uri))}`);
    } else {
        console.log(`  MongoDB     : ${chalk.red('(MONGODB_URI not set)')}`);
    }
    console.log('');
}

program
    .name('rp-db')
    .description('Database setup, schema validation, and test data seeding for RestroPulse')
    .version('1.0.0')
    .option('--env <env>', 'Target environment: development | staging | production', 'development')
    .hook('preAction', async (thisCommand) => {
        await loadEnv(thisCommand.opts().env as string);
        printBanner();
    });

program
    .command('setup')
    .description('Set up database collections and indexes')
    .action(setupCommand);

program
    .command('validate')
    .description('Validate database schemas and indexes')
    .option('--fix', 'Attempt to fix validation issues')
    .action(validateCommand);

program
    .command('seed')
    .description('Seed database with sample data')
    .option('--clean', 'Clear existing data before seeding')
    .option('--allow-missing-razorpay', 'Bypass Razorpay plan ID completeness check (not recommended)')
    .action(seedCommand);

program
    .command('reset')
    .description('Drop all collections and recreate database with indexes and defaults (10s safety delay)')
    .option('--allow-missing-razorpay', 'Bypass Razorpay plan ID completeness check (not recommended)')
    .action(resetCommand);

program
    .command('razorpay-setup')
    .description('Create Razorpay subscription plans and write plan IDs back to MongoDB')
    .option('--dry-run', 'Preview what would be created without making API calls or DB writes')
    .option('--force', 'Overwrite existing Razorpay plan IDs in MongoDB')
    .action(razorpaySetupCommand);

program
    .command('delete-account')
    .description('Delete a user account and all associated data (posts, strategies, subscriptions, etc.)')
    .option('--phone <phone>', 'Phone number of the user to delete')
    .option('--restaurant-id <id>', 'Restaurant ID to delete (skips user lookup)')
    .option('--dry-run', 'Preview what would be deleted without making any changes')
    .option('--no-archive', 'Skip JSON archive (archive is written by default)')
    .action(deleteAccountCommand);

program
    .command('acquire-restaurants')
    .description('Download restaurant data from Kaggle CSV + OSM and write fixture JSON files')
    .requiredOption('--city <city>', 'Target city: hyderabad | mumbai | bangalore')
    .option('--csv <path>', 'Path to downloaded Kaggle CSV file (omit to see download instructions)')
    .option('--all', 'Fetch all restaurants with no limit (default behaviour; --limit overrides)')
    .option('--limit <n>', 'Cap output at N records (omit or use --all for no cap)')
    .option('--skip-osm', 'Skip OpenStreetMap enrichment (faster, less complete)')
    .option('--output <path>', 'Custom output path (default: apps/db-cli/data/restaurants/restaurants-{city}.json)')
    .action((options) => acquireRestaurantsCommand({
        city: options.city,
        csv: options.csv,
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
        skipOsm: !!options.skipOsm,
        output: options.output,
    }));

program
    .command('atlas-inventory')
    .description('List all Atlas users/roles and all databases into a sanitized inventory report')
    .option('--output <path>', 'Output JSON path')
    .action(atlasInventoryCommand);

program
    .command('atlas-backup-clone')
    .description('Clone non-system/non-target databases into timestamped backup databases')
    .option('--execute', 'Execute cloning (default is dry-run)')
    .option('--output <path>', 'Output manifest JSON path')
    .action(atlasBackupCloneCommand);

program
    .command('atlas-provision')
    .description('Provision target DBs, scoped roles/users, and one super-admin with AKV-backed credentials')
    .option('--execute', 'Execute provisioning (default is dry-run)')
    .option('--confirm <env>', 'Non-interactive confirmation token (must match --env)')
    .option('--vault-name <name>', 'Azure Key Vault name override')
    .option('--output <path>', 'Output metadata JSON path (no secrets)')
    .action(atlasProvisionCommand);

program
    .command('atlas-validate-access')
    .description('Validate scoped user isolation and super-admin access using metadata + AKV secrets')
    .option('--input <path>', 'Provision metadata JSON path')
    .action(atlasValidateAccessCommand);

program
    .command('atlas-cleanup-legacy')
    .description('Dry-run or execute cleanup of legacy users/databases (gated)')
    .option('--execute', 'Execute deletion (default is dry-run)')
    .option('--confirm <env>', 'Non-interactive confirmation token (must match --env)')
    .option('--input <path>', 'Validation report path for traceability')
    .action(atlasCleanupLegacyCommand);

program.parse();
