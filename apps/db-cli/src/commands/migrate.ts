import chalk from 'chalk';
import ora from 'ora';
import { randomUUID } from 'node:crypto';
import { connect, getConfig, disconnect } from '../config/database.js';

/**
 * Migration: subscription-history
 *
 * Transitions the subscriptions collection from a hard unique index on
 * restaurantId to a partial unique index (unique only where endedAt is null).
 * This allows multiple historical subscription records per restaurant while
 * still enforcing at most one active subscription at a time.
 *
 * Steps:
 *   1. Backfill endedAt: null on all existing documents that lack the field
 *   2. Drop the old restaurantId_1 unique index
 *   3. Create the new partial unique index
 */
export async function migrateCommand(options: { migration: string }): Promise<void> {
    const migrations: Record<string, () => Promise<void>> = {
        'unique-post-slot-index': migrateUniquePostSlotIndex,
        'subscription-history': migrateSubscriptionHistory,
        'rename-strategy-id-to-cycle-id': migrateRenameStrategyIdToCycleId,
        'sparse-oauth-session-id-index': migrateSparseOauthSessionIdIndex,
        'split-post-platforms': migrateSplitPostPlatforms,
    };

    const run = migrations[options.migration];
    if (!run) {
        console.error(chalk.red(`Unknown migration: "${options.migration}"`));
        console.log(chalk.gray('Available migrations:'));
        for (const name of Object.keys(migrations)) {
            console.log(chalk.gray(`  - ${name}`));
        }
        process.exit(1);
    }

    await run();
}

/**
 * Migration: unique-post-slot-index
 *
 * split-post-platforms created cycleId_1_scheduledFor_1_platform_1 as a plain
 * (non-unique) index, so two rolling-window ticks running at the same time
 * could both upsert the same slot and create duplicate posts. This makes the
 * index unique, partial on cycleId being a string so adhoc posts (no cycleId)
 * are unaffected.
 *
 * Steps:
 *   1. Look for existing duplicates. If any exist, list them and stop without
 *      changing anything -- deciding which duplicate post to keep is a human
 *      call (one may already be approved or published).
 *   2. Drop the old non-unique index.
 *   3. Create the unique partial index under the same name.
 */
async function migrateUniquePostSlotIndex(): Promise<void> {
    const config = getConfig();
    const spinner = ora();
    const indexName = 'cycleId_1_scheduledFor_1_platform_1';

    try {
        spinner.start('Connecting to MongoDB...');
        const client = await connect();
        spinner.succeed('Connected to MongoDB');

        const db = client.db(config.database);
        const col = db.collection('posts');

        spinner.start('Checking for duplicate cycle-slot posts...');
        const duplicates = await col
            .aggregate<{ _id: { cycleId: string; scheduledFor: string; platform: string }; ids: unknown[]; count: number }>([
                { $match: { cycleId: { $type: 'string' } } },
                {
                    $group: {
                        _id: { cycleId: '$cycleId', scheduledFor: '$scheduledFor', platform: '$platform' },
                        ids: { $push: '$_id' },
                        count: { $sum: 1 },
                    },
                },
                { $match: { count: { $gt: 1 } } },
            ])
            .toArray();

        if (duplicates.length > 0) {
            spinner.fail(`Found ${duplicates.length} cycle slot(s) with duplicate posts -- nothing changed`);
            for (const dup of duplicates) {
                console.log(
                    chalk.red(
                        `  - cycle ${dup._id.cycleId} @ ${dup._id.scheduledFor} ${dup._id.platform}: ` +
                            `${dup.count} posts (${dup.ids.map(String).join(', ')})`,
                    ),
                );
            }
            console.log(chalk.gray('Remove the extra posts, then run this migration again.'));
            process.exitCode = 1;
            return;
        }
        spinner.succeed('No duplicate cycle-slot posts');

        const existing = (await col.indexes()).find((idx) => idx.name === indexName);
        if (existing?.unique) {
            spinner.succeed(`${indexName} is already unique -- nothing to do`);
            return;
        }

        if (existing) {
            spinner.start(`Dropping non-unique ${indexName}...`);
            await col.dropIndex(indexName);
            spinner.succeed(`Dropped non-unique ${indexName}`);
        }

        spinner.start(`Creating unique ${indexName}...`);
        await col.createIndex(
            { cycleId: 1, scheduledFor: 1, platform: 1 },
            { name: indexName, unique: true, partialFilterExpression: { cycleId: { $type: 'string' } } },
        );
        spinner.succeed(`Created unique ${indexName}`);

        console.log(chalk.green('\nMigration unique-post-slot-index complete!'));
    } catch (err: any) {
        spinner.fail('Migration failed');
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
    } finally {
        await disconnect();
    }
}

/**
 * Migration: sparse-oauth-session-id-index
 *
 * The oauthSessions collection stores two document shapes: { type:
 * 'oauth_state', state, ... } (Instagram OAuth CSRF tokens, no sessionId
 * field) and { type: 'pending_selection', sessionId, ... } (multi-account
 * picker sessions). The original unique index on sessionId was not sparse,
 * so every oauth_state document (missing sessionId) collided on the implicit
 * sessionId: null value -- only the very first insert ever succeeded, and
 * every OAuth connection attempt since has failed with E11000.
 *
 * Steps:
 *   1. Drop the old non-sparse unique index
 *   2. Create the new sparse unique index (only enforced where sessionId exists)
 */
async function migrateSparseOauthSessionIdIndex(): Promise<void> {
    const config = getConfig();
    const spinner = ora();

    try {
        spinner.start('Connecting to MongoDB...');
        const client = await connect();
        spinner.succeed('Connected to MongoDB');

        const db = client.db(config.database);
        const col = db.collection('oauthSessions');

        spinner.start('Dropping old non-sparse unique index on sessionId...');
        try {
            await col.dropIndex('sessionId_1');
            spinner.succeed('Dropped old sessionId_1 index');
        } catch (err: any) {
            if (err.codeName === 'IndexNotFound' || err.code === 27) {
                spinner.warn('Old sessionId_1 index not found -- already dropped or never created');
            } else {
                throw err;
            }
        }

        spinner.start('Creating sparse unique index on sessionId...');
        await col.createIndex(
            { sessionId: 1 },
            { unique: true, sparse: true, name: 'sessionId_1' },
        );
        spinner.succeed('Created sparse unique index: sessionId_1');

        console.log(chalk.green('\nMigration sparse-oauth-session-id-index complete!'));
        console.log(chalk.gray('  Run "npm run validate" to confirm indexes are in place.'));

    } catch (err: any) {
        spinner.fail('Migration failed');
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
    } finally {
        await disconnect();
    }
}

async function migrateRenameStrategyIdToCycleId(): Promise<void> {
    const config = getConfig();
    const spinner = ora();

    try {
        spinner.start('Connecting to MongoDB...');
        const client = await connect();
        spinner.succeed('Connected to MongoDB');

        const db = client.db(config.database);
        const col = db.collection('posts');

        spinner.start('Renaming posts.strategyId -> posts.cycleId...');
        const rename = await col.updateMany(
            { strategyId: { $exists: true } },
            [{ $set: { cycleId: '$strategyId' } }, { $unset: 'strategyId' }],
        );
        spinner.succeed(`Renamed on ${rename.modifiedCount} document(s)`);

        spinner.start('Creating compound index { cycleId: 1, scheduledFor: 1 }...');
        await col.createIndex(
            { cycleId: 1, scheduledFor: 1 },
            { name: 'cycleId_1_scheduledFor_1' },
        );
        spinner.succeed('Created compound index: cycleId_1_scheduledFor_1');

        console.log(chalk.green('\nMigration rename-strategy-id-to-cycle-id complete!'));
    } catch (err: any) {
        spinner.fail('Migration failed');
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
    } finally {
        await disconnect();
    }
}

async function migrateSubscriptionHistory(): Promise<void> {
    const config = getConfig();
    const spinner = ora();

    try {
        spinner.start('Connecting to MongoDB...');
        const client = await connect();
        spinner.succeed('Connected to MongoDB');

        const db = client.db(config.database);
        const col = db.collection('subscriptions');

        // Step 1: backfill endedAt: null on all documents that don't have it
        spinner.start('Backfilling endedAt: null on existing subscription documents...');
        const backfill = await col.updateMany(
            { endedAt: { $exists: false } },
            { $set: { endedAt: null } },
        );
        spinner.succeed(`Backfilled ${backfill.modifiedCount} document(s)`);

        // Step 2: drop the old hard unique index (if it exists)
        spinner.start('Dropping old unique index on restaurantId...');
        try {
            await col.dropIndex('restaurantId_1');
            spinner.succeed('Dropped old restaurantId_1 index');
        } catch (err: any) {
            if (err.codeName === 'IndexNotFound' || err.code === 27) {
                spinner.warn('Old restaurantId_1 index not found — already dropped or never created');
            } else {
                throw err;
            }
        }

        // Step 3: create new partial unique index
        spinner.start('Creating partial unique index on restaurantId where endedAt is null...');
        await col.createIndex(
            { restaurantId: 1 },
            { unique: true, partialFilterExpression: { endedAt: null }, name: 'restaurantId_1_active' },
        );
        spinner.succeed('Created partial unique index: restaurantId_1_active');

        console.log(chalk.green('\nMigration subscription-history complete!'));
        console.log(chalk.gray('  Run "npm run validate" to confirm indexes are in place.'));

    } catch (err: any) {
        spinner.fail('Migration failed');
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
    } finally {
        await disconnect();
    }
}

/**
 * Migration: split-post-platforms
 *
 * Posts used to carry `platforms: Platform[]` and could target Instagram and
 * Facebook simultaneously, with per-platform result fields (instagramMediaId,
 * facebookPostId) bolted onto the same document. This collapsed a platform
 * failure into an all-or-nothing status on one post -- a partial success (e.g.
 * Instagram published, Facebook failed) had its successful media ID silently
 * dropped and got re-published on retry. Each post now carries a single
 * `platform` field; a document that used to target both platforms is split
 * into two documents sharing a new `groupId` for traceability.
 *
 * Steps (per existing post document, keyed by whether `platforms` is present):
 *   - platforms.length === 1: rename in place (same _id) to `platform`,
 *     collapse instagramMediaId/facebookPostId -> externalPostId, assign a
 *     fresh groupId.
 *   - platforms.length === 2: the original _id keeps the first platform;
 *     insert a new document (new _id) for the second platform. Both share one
 *     new groupId. `stats` (never actually populated by any writer in this
 *     codebase) is copied to both -- there is no historical per-platform
 *     breakdown to preserve.
 *   - platforms.length === 0 or missing: logged and skipped, not assumed.
 * Then: drop the old { platforms: 1 } index, create { platform: 1 } and
 * { groupId: 1 }, and widen cycleId_1_scheduledFor_1 (created by
 * rename-strategy-id-to-cycle-id) to include platform.
 *
 * This is NOT run automatically -- see docs/plan for the staging-then-production
 * rollout sequence. Take a posts collection snapshot immediately before running;
 * the split is not cleanly reversible once post statuses diverge post-migration.
 */
async function migrateSplitPostPlatforms(): Promise<void> {
    const config = getConfig();
    const spinner = ora();

    try {
        spinner.start('Connecting to MongoDB...');
        const client = await connect();
        spinner.succeed('Connected to MongoDB');

        const db = client.db(config.database);
        const col = db.collection('posts');

        spinner.start('Scanning posts with a platforms array...');
        const docs = await col.find({ platforms: { $exists: true } }).toArray();
        spinner.succeed(`Found ${docs.length} post(s) to migrate`);

        let renamed = 0;
        let split = 0;
        let skipped = 0;

        spinner.start('Splitting posts...');
        for (const doc of docs) {
            const platforms: string[] = Array.isArray(doc.platforms) ? doc.platforms : [];

            if (platforms.length === 0) {
                console.log(chalk.yellow(`  Skipping ${doc._id}: empty/missing platforms array`));
                skipped++;
                continue;
            }

            const externalIdFor = (platform: string): string | null =>
                platform === 'INSTAGRAM' ? (doc.instagramMediaId ?? null) : (doc.facebookPostId ?? null);

            if (platforms.length === 1) {
                await col.updateOne(
                    { _id: doc._id },
                    {
                        $set: {
                            platform: platforms[0],
                            groupId: randomUUID(),
                            externalPostId: externalIdFor(platforms[0]),
                        },
                        $unset: { platforms: '', instagramMediaId: '', facebookPostId: '' },
                    },
                );
                renamed++;
                continue;
            }

            // platforms.length >= 2 (in practice always 2: INSTAGRAM + FACEBOOK).
            // First platform reuses the existing _id; every other platform
            // becomes a new document sharing this groupId.
            const groupId = randomUUID();
            const [firstPlatform, ...restPlatforms] = platforms;

            await col.updateOne(
                { _id: doc._id },
                {
                    $set: {
                        platform: firstPlatform,
                        groupId,
                        externalPostId: externalIdFor(firstPlatform),
                    },
                    $unset: { platforms: '', instagramMediaId: '', facebookPostId: '' },
                },
            );

            const { _id, platforms: _p, instagramMediaId: _ig, facebookPostId: _fb, ...rest } = doc as any;
            for (const platform of restPlatforms) {
                await col.insertOne({
                    ...rest,
                    platform,
                    groupId,
                    externalPostId: externalIdFor(platform),
                });
            }

            split++;
        }
        spinner.succeed(`Migrated: ${renamed} renamed in place, ${split} split into multiple documents, ${skipped} skipped`);

        spinner.start('Dropping old platforms index...');
        try {
            await col.dropIndex('platforms_1');
            spinner.succeed('Dropped old platforms_1 index');
        } catch (err: any) {
            if (err.codeName === 'IndexNotFound' || err.code === 27) {
                spinner.warn('Old platforms_1 index not found -- already dropped or never created');
            } else {
                throw err;
            }
        }

        spinner.start('Creating platform and groupId indexes...');
        await col.createIndex({ platform: 1 }, { name: 'platform_1' });
        await col.createIndex({ groupId: 1 }, { name: 'groupId_1' });
        spinner.succeed('Created platform_1 and groupId_1 indexes');

        spinner.start('Widening cycleId_1_scheduledFor_1 to include platform...');
        try {
            await col.dropIndex('cycleId_1_scheduledFor_1');
            spinner.succeed('Dropped old cycleId_1_scheduledFor_1 index');
        } catch (err: any) {
            if (err.codeName === 'IndexNotFound' || err.code === 27) {
                spinner.warn('Old cycleId_1_scheduledFor_1 index not found -- already dropped or never created');
            } else {
                throw err;
            }
        }
        await col.createIndex(
            { cycleId: 1, scheduledFor: 1, platform: 1 },
            { name: 'cycleId_1_scheduledFor_1_platform_1' },
        );
        spinner.succeed('Created cycleId_1_scheduledFor_1_platform_1 index');

        console.log(chalk.green('\nMigration split-post-platforms complete!'));
        console.log(chalk.gray('  Run "npm run validate" to confirm indexes are in place.'));

    } catch (err: any) {
        spinner.fail('Migration failed');
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
    } finally {
        await disconnect();
    }
}

