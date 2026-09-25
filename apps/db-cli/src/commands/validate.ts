import chalk from 'chalk';
import ora from 'ora';
import { connect, getConfig, disconnect } from '../config/database.js';
import { COLLECTIONS } from '../schemas/collections.js';

interface ValidateOptions {
    fix?: boolean;
}

interface ValidationResult {
    collection: string;
    issues: string[];
    fixed: string[];
}

export async function validateCommand(options: ValidateOptions): Promise<void> {
    const config = getConfig();
    const spinner = ora();
    const results: ValidationResult[] = [];

    try {
        spinner.start('Connecting to MongoDB...');
        const client = await connect();
        spinner.succeed('Connected to MongoDB');

        console.log(chalk.cyan(`\nValidating database: ${chalk.bold(config.database)}`));

        const db = client.db(config.database);
        const existingCollections = await db.listCollections().toArray();
        const existingNames = existingCollections.map(c => c.name);

        for (const schema of COLLECTIONS) {
            const result: ValidationResult = {
                collection: schema.name,
                issues: [],
                fixed: [],
            };

            spinner.start(`Validating: ${schema.name}`);

            // Check if collection exists
            if (!existingNames.includes(schema.name)) {
                result.issues.push('Collection does not exist');

                if (options.fix) {
                    try {
                        await db.createCollection(schema.name, {
                            validator: schema.validator,
                            validationLevel: 'moderate',
                            validationAction: 'warn',
                        });
                        result.fixed.push('Created collection');
                    } catch (err: any) {
                        result.issues.push(`Failed to create: ${err.message}`);
                    }
                }
            } else {
                // Validate indexes
                const col = db.collection(schema.name);
                const existingIndexes = await col.indexes();
                const existingIndexKeys = existingIndexes.map(idx =>
                    JSON.stringify(idx.key)
                );

                for (const index of schema.indexes) {
                    const indexKey = JSON.stringify(index.spec);
                    if (!existingIndexKeys.includes(indexKey)) {
                        result.issues.push(`Missing index: ${indexKey}`);

                        if (options.fix) {
                            try {
                                await col.createIndex(index.spec, index.options || {});
                                result.fixed.push(`Created index: ${indexKey}`);
                            } catch (err: any) {
                                result.issues.push(`Failed to create index: ${err.message}`);
                            }
                        }
                    }
                }
            }

            // Report results
            if (result.issues.length === 0) {
                spinner.succeed(`${schema.name}: OK`);
            } else if (result.fixed.length === result.issues.length) {
                spinner.warn(`${schema.name}: Fixed ${result.fixed.length} issue(s)`);
            } else {
                spinner.fail(`${schema.name}: ${result.issues.length} issue(s)`);
                result.issues.forEach(issue => {
                    console.log(chalk.red(`    - ${issue}`));
                });
                result.fixed.forEach(fix => {
                    console.log(chalk.green(`    + ${fix}`));
                });
            }

            results.push(result);
        }

        // Summary
        const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
        const totalFixed = results.reduce((sum, r) => sum + r.fixed.length, 0);

        console.log(chalk.cyan('\n--- Validation Summary ---'));
        if (totalIssues === 0) {
            console.log(chalk.green('All schemas validated successfully!'));
        } else {
            console.log(chalk.yellow(`Total issues: ${totalIssues}`));
            if (options.fix) {
                console.log(chalk.green(`Fixed: ${totalFixed}`));
                console.log(chalk.red(`Remaining: ${totalIssues - totalFixed}`));
            } else {
                console.log(chalk.gray('Run with --fix to attempt automatic fixes'));
            }
        }

    } catch (err: any) {
        spinner.fail('Validation failed');
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
    } finally {
        await disconnect();
    }
}
