import chalk from 'chalk';
import ora from 'ora';
import { connect, getConfig, disconnect } from '../config/database.js';
import { getResolvedEnv, requireNonDevConfirmation } from '../lib/env.js';
import { archiveAccount, toObjectId } from '@restropulse/db';

interface DeleteAccountOptions {
    phone?: string;
    restaurantId?: string;
    dryRun?: boolean;
    noArchive?: boolean;
}

export async function deleteAccountCommand(options: DeleteAccountOptions): Promise<void> {
    if (!options.phone && !options.restaurantId) {
        console.error(chalk.red('Error: provide --phone or --restaurant-id'));
        process.exit(1);
    }

    const config = getConfig();
    const spinner = ora();

    if (!options.dryRun) {
        if (getResolvedEnv() !== 'development') {
            await requireNonDevConfirmation('delete-account');
        }
        console.log(chalk.red.bold('\nWARNING: You are about to permanently delete an account!'));
        console.log(chalk.red('This will permanently delete all associated data.'));
        console.log(chalk.gray(`  Environment: ${getResolvedEnv()}`));
        console.log(chalk.gray('Press Ctrl+C within 10 seconds to cancel...\n'));
        await new Promise(resolve => setTimeout(resolve, 10000));
    }

    if (options.dryRun) {
        console.log(chalk.yellow.bold('\n[DRY RUN] No data will be deleted.\n'));
    }

    try {
        spinner.start('Connecting to MongoDB...');
        const client = await connect();
        spinner.succeed('Connected to MongoDB');

        const db = client.db(config.database);
        console.log(chalk.cyan(`\nDatabase: ${chalk.bold(config.database)}`));

        // Resolve restaurantId from phone if needed
        let restaurantId = options.restaurantId;
        let userId: string | null = null;

        if (options.phone) {
            spinner.start(`Looking up user by phone: ${options.phone}`);
            const user = await db.collection('users').findOne({ phone: options.phone });
            if (!user) {
                spinner.fail(`No user found with phone: ${options.phone}`);
                process.exit(1);
            }
            userId = user._id.toString();
            restaurantId = user.restaurantId ?? restaurantId;
            spinner.succeed(`Found user: ${user.name ?? user._id} (id: ${userId})`);
            if (restaurantId) {
                console.log(chalk.gray(`  restaurantId: ${restaurantId}`));
            } else {
                console.log(chalk.yellow('  User has no restaurantId -- only the user record will be deleted.'));
            }
        }

        if (restaurantId && !userId) {
            // Resolve userId from restaurantId
            const user = await db.collection('users').findOne({ restaurantId });
            if (user) {
                userId = user._id.toString();
            }
        }

        // Preview counts before deletion
        const counts: Record<string, number> = {};

        if (userId) {
            counts['users'] = await db.collection('users').countDocuments({ _id: toObjectId(userId) as any });
        }

        if (restaurantId) {
            counts['restaurants'] = await db.collection('restaurants').countDocuments({ _id: toObjectId(restaurantId) as any });
            counts['posts'] = await db.collection('posts').countDocuments({ restaurantId });
            counts['contentStrategies'] = await db.collection('contentStrategies').countDocuments({ restaurantId });
            counts['strategyCycles'] = await db.collection('strategyCycles').countDocuments({ restaurantId });
            counts['subscriptions'] = await db.collection('subscriptions').countDocuments({ restaurantId });
            counts['couponRedemptions'] = await db.collection('couponRedemptions').countDocuments({ restaurantId });
            counts['creditPurchases'] = await db.collection('creditPurchases').countDocuments({ restaurantId });
            counts['invoices'] = await db.collection('invoices').countDocuments({ restaurantId });
        }

        console.log(chalk.cyan('\nRecords to delete:'));
        let total = 0;
        for (const [col, count] of Object.entries(counts)) {
            const color = count > 0 ? chalk.white : chalk.gray;
            console.log(color(`  ${col.padEnd(22)} ${count}`));
            total += count;
        }
        console.log(chalk.bold(`\n  Total: ${total} record(s)`));

        if (options.dryRun) {
            console.log(chalk.yellow('\n[DRY RUN] Exiting without deleting anything.'));
            return;
        }

        if (total === 0) {
            console.log(chalk.yellow('\nNothing to delete.'));
            return;
        }

        // Archive all documents to MongoDB before deletion
        if (!options.noArchive) {
            spinner.start('Archiving data to MongoDB...');
            const archiveId = await archiveAccount(db, userId, restaurantId ?? null, 'CLI', config.database, options.phone);
            spinner.succeed(`Archived to archivedAccounts (id: ${archiveId})`);
        }

        // Delete in dependency order (children before parents)
        const results: Record<string, number> = {};

        if (restaurantId) {
            for (const col of [
                'posts',
                'contentStrategies',
                'strategyCycles',
                'subscriptions',
                'couponRedemptions',
                'creditPurchases',
                'invoices',
            ]) {
                spinner.start(`Deleting ${col}...`);
                const r = await db.collection(col).deleteMany({ restaurantId });
                results[col] = r.deletedCount;
                spinner.succeed(`Deleted ${r.deletedCount} ${col}`);
            }

            spinner.start('Deleting restaurant...');
            const r = await db.collection('restaurants').deleteOne({ _id: toObjectId(restaurantId) as any });
            results['restaurants'] = r.deletedCount;
            spinner.succeed(`Deleted ${r.deletedCount} restaurant`);
        }

        if (userId) {
            spinner.start('Deleting user...');
            const r = await db.collection('users').deleteOne({ _id: toObjectId(userId) as any });
            results['users'] = r.deletedCount;
            spinner.succeed(`Deleted ${r.deletedCount} user`);
        }

        const deletedTotal = Object.values(results).reduce((a, b) => a + b, 0);
        console.log(chalk.green(`\nAccount deleted. ${deletedTotal} record(s) removed.`));

    } catch (err: any) {
        spinner.fail('Delete failed');
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
    } finally {
        await disconnect();
    }
}
