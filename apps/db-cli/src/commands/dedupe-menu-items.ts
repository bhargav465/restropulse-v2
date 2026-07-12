import chalk from 'chalk';
import ora from 'ora';
import { connect, getConfig, disconnect } from '../config/database.js';
import { getResolvedEnv, requireNonDevConfirmation } from '../lib/env.js';

interface DedupeMenuItemsOptions {
    /** When true, rename later duplicates. Default (false) is a read-only report. */
    apply?: boolean;
}

interface DuplicateMember {
    _id: unknown;
    createdAt?: Date;
}

interface DuplicateGroup {
    _id: { restaurantId: string; name: string };
    count: number;
    members: DuplicateMember[];
}

/**
 * Reports (and optionally renames) duplicate menu items sharing the same
 * (restaurantId, name) key — the CSV upsert key that Brief 03 makes unique.
 *
 * Policy (owner-confirmed): RENAME only, never merge or delete. Dry-run by
 * default. With --apply, the FIRST member of each group (oldest by createdAt,
 * then _id) keeps its name; every later duplicate is renamed to "<name> (2)",
 * "<name> (3)", … skipping any suffix already taken within that restaurant.
 * This clears the way for the unique index without destroying data — the owner
 * can hand-merge the renamed rows afterwards.
 */
export async function dedupeMenuItemsCommand(options: DedupeMenuItemsOptions): Promise<void> {
    const apply = !!options.apply;
    const config = getConfig();
    const spinner = ora();

    if (apply) {
        if (getResolvedEnv() !== 'development') {
            await requireNonDevConfirmation('dedupe-menu-items --apply');
        }
        console.log(chalk.yellow.bold('\n[APPLY] Later duplicates will be RENAMED (never deleted).'));
    } else {
        console.log(chalk.cyan.bold('\n[DRY RUN] Reporting duplicates only — no changes. Use --apply to rename.'));
    }

    try {
        spinner.start('Connecting to MongoDB...');
        const client = await connect();
        spinner.succeed('Connected to MongoDB');

        const db = client.db(config.database);
        const itemsCol = db.collection('menu_items');
        console.log(chalk.cyan(`\nDatabase: ${chalk.bold(config.database)}\n`));

        spinner.start('Scanning menu_items for (restaurantId, name) duplicates...');
        const groups = (await itemsCol
            .aggregate([
                {
                    $group: {
                        _id: { restaurantId: '$restaurantId', name: '$name' },
                        count: { $sum: 1 },
                        members: { $push: { _id: '$_id', createdAt: '$createdAt' } },
                    },
                },
                { $match: { count: { $gt: 1 } } },
                { $sort: { '_id.restaurantId': 1, '_id.name': 1 } },
            ])
            .toArray()) as unknown as DuplicateGroup[];
        spinner.succeed(`Scan complete: ${groups.length} duplicate name group(s) found`);

        if (groups.length === 0) {
            console.log(chalk.green('\nNo duplicate menu-item names. The unique index can be enforced safely.\n'));
            return;
        }

        const totalDuplicates = groups.reduce((sum, g) => sum + (g.count - 1), 0);
        console.log(
            chalk.yellow(
                `\n${groups.length} group(s), ${totalDuplicates} later duplicate row(s) that would be renamed:\n`,
            ),
        );

        let renamed = 0;
        for (const group of groups) {
            const { restaurantId, name } = group._id;
            // Keep the oldest (createdAt, then _id) as the canonical row.
            const members = [...group.members].sort((a, b) => {
                const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                if (at !== bt) return at - bt;
                return String(a._id).localeCompare(String(b._id));
            });

            console.log(chalk.white(`  restaurant ${restaurantId} · "${name}" × ${group.count}`));
            console.log(chalk.gray(`    keep   ${String(members[0]._id)}  (canonical)`));

            // Names currently taken within this restaurant (avoid new collisions).
            const taken = new Set(
                (await itemsCol
                    .find({ restaurantId }, { projection: { name: 1 } })
                    .toArray())
                    .map((d) => String(d.name)),
            );

            for (const dup of members.slice(1)) {
                let suffix = 2;
                let candidate = `${name} (${suffix})`;
                while (taken.has(candidate)) {
                    suffix += 1;
                    candidate = `${name} (${suffix})`;
                }
                taken.add(candidate);

                if (apply) {
                    await itemsCol.updateOne(
                        { _id: dup._id as never },
                        { $set: { name: candidate, updatedAt: new Date() } },
                    );
                    console.log(chalk.green(`    rename ${String(dup._id)}  ->  "${candidate}"`));
                } else {
                    console.log(chalk.yellow(`    would rename ${String(dup._id)}  ->  "${candidate}"`));
                }
                renamed += 1;
            }
        }

        if (apply) {
            console.log(chalk.green.bold(`\nDone. Renamed ${renamed} duplicate row(s).`));
            console.log(
                chalk.gray('Re-run `rp-db setup` (or restart the API) to build the unique menu_items index.\n'),
            );
        } else {
            console.log(chalk.yellow.bold(`\n[DRY RUN] Would rename ${renamed} duplicate row(s). Re-run with --apply.\n`));
        }
    } catch (error) {
        spinner.fail('dedupe-menu-items failed');
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
    } finally {
        await disconnect();
    }
}
