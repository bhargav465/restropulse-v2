import chalk from 'chalk';
import ora from 'ora';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsvFile } from '../lib/kaggle-ingestor.js';
import { normalizeRow, aggregateMenuItemRows, deduplicate as deduplicateFields } from '../lib/restaurant-normalizer.js';
import { deduplicate } from '../lib/restaurant-deduplicator.js';
import { enrichWithOsm } from '../lib/osm-enricher.js';
import type { RestaurantFixture } from '../lib/restaurant-normalizer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../../data/restaurants');

export interface AcquireOptions {
    city: string;
    csv?: string;
    limit?: number;      // undefined = no limit (fetch all)
    skipOsm: boolean;
    output?: string;
}

// Kaggle dataset slugs for reference — download must be done by the operator
const KAGGLE_DATASETS: Record<string, string> = {
    hyderabad: 'batjoker/zomato-restaurants-hyderabad',
    mumbai:    'sleepyowl007/zomato-mumbai-dataset',
    bangalore: 'himanshupoddar/zomato-bangalore-restaurants',
};

export async function acquireRestaurantsCommand(options: AcquireOptions): Promise<void> {
    const city = options.city.toLowerCase();
    const validCities = ['hyderabad', 'mumbai', 'bangalore'];

    if (!validCities.includes(city)) {
        console.error(chalk.red(`Invalid city: "${options.city}". Valid: ${validCities.join(', ')}`));
        process.exit(1);
    }

    const csvPath = options.csv ? resolve(options.csv) : null;
    const outputPath = options.output
        ? resolve(options.output)
        : resolve(DATA_DIR, `restaurants-${city}.json`);

    // If no CSV provided, print download instructions and exit
    if (!csvPath) {
        const slug = KAGGLE_DATASETS[city];
        console.log(chalk.cyan.bold(`\nRestaurant Data Acquisition — ${city}`));
        console.log(chalk.yellow('\nNo --csv file provided. Download the Kaggle dataset first:\n'));
        console.log(chalk.white('  # Install Kaggle CLI (one-time)'));
        console.log(chalk.white('  pip install kaggle'));
        console.log(chalk.white('  # Place your kaggle.json API token at ~/.kaggle/kaggle.json\n'));
        console.log(chalk.white(`  kaggle datasets download ${slug} -p ./tmp/`));
        console.log(chalk.white(`  unzip ./tmp/${slug.split('/')[1]}.zip -d ./tmp/\n`));
        console.log(chalk.white('  # Then re-run:'));
        console.log(chalk.white(`  npm run db-cli -- acquire-restaurants --city ${city} --csv ./tmp/<filename>.csv`));
        console.log('');
        console.log(chalk.gray('Alternative: download manually from https://www.kaggle.com/datasets/' + slug));
        process.exit(0);
    }

    const spinner = ora();

    console.log(chalk.cyan.bold(`\nRestaurant Data Acquisition — ${chalk.white(city)}`));
    console.log(chalk.gray(`  CSV:    ${csvPath}`));
    console.log(chalk.gray(`  Output: ${outputPath}`));
    console.log(chalk.gray(`  Limit:  ${options.limit} records`));
    console.log('');

    // Phase 1: Parse CSV — detect format from headers
    spinner.start('Detecting CSV format...');
    const allRows: Record<string, string>[] = [];
    let parsedTotal = 0;
    let isMenuItemFormat = false;

    try {
        parsedTotal = await parseCsvFile(
            csvPath,
            (row) => {
                // Detect metropolitan/menu-item format on first row
                if (allRows.length === 0) {
                    isMenuItemFormat = 'Item Name' in row || 'Best Seller' in row;
                }
                allRows.push(row);
            },
            (count) => { spinner.text = `Parsing CSV... ${count.toLocaleString()} rows read`; },
        );
    } catch (err) {
        spinner.fail(`CSV parse failed: ${(err as Error).message}`);
        process.exit(1);
    }

    let validRecords: RestaurantFixture[];

    if (isMenuItemFormat) {
        spinner.text = `Aggregating ${parsedTotal.toLocaleString()} menu-item rows into restaurants...`;
        validRecords = aggregateMenuItemRows(allRows, city);
        spinner.succeed(
            `Parsed ${parsedTotal.toLocaleString()} menu-item rows → ${validRecords.length.toLocaleString()} restaurants (${city} only)`,
        );
    } else {
        const rawRecords = allRows.map(row => normalizeRow(row, city));
        validRecords = rawRecords.filter((r): r is RestaurantFixture => r !== null);
        spinner.succeed(
            `Parsed ${parsedTotal.toLocaleString()} rows — ${validRecords.length.toLocaleString()} valid (${(parsedTotal - validRecords.length).toLocaleString()} skipped)`,
        );
    }

    // Phase 2: Deduplicate
    spinner.start('Deduplicating...');
    const deduped = deduplicate(validRecords);
    spinner.succeed(`Deduplicated: ${validRecords.length.toLocaleString()} → ${deduped.length.toLocaleString()} unique records`);

    const limited = options.limit !== undefined ? deduped.slice(0, options.limit) : deduped;
    if (options.limit !== undefined && deduped.length > options.limit) {
        console.log(chalk.gray(`  Limit applied: keeping ${options.limit} of ${deduped.length.toLocaleString()}`));
    } else if (options.limit === undefined) {
        console.log(chalk.gray(`  No limit — keeping all ${deduped.length.toLocaleString()} records`));
    }

    // Phase 3: OSM enrichment
    let finalRecords = limited;
    if (!options.skipOsm) {
        spinner.start('Fetching OSM data...');
        try {
            finalRecords = await enrichWithOsm(
                limited,
                city,
                (msg) => { spinner.text = msg; },
            );
            spinner.succeed('OSM enrichment complete');
        } catch (err) {
            spinner.warn(`OSM enrichment failed (${(err as Error).message}) — using Kaggle data only`);
        }
    } else {
        console.log(chalk.gray('  OSM enrichment skipped (--skip-osm)'));
    }

    // Phase 4: Write output
    spinner.start(`Writing ${finalRecords.length.toLocaleString()} records...`);
    try {
        if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
        writeFileSync(outputPath, JSON.stringify(finalRecords, null, 2), 'utf8');
        spinner.succeed(`Written: ${outputPath}`);
    } catch (err) {
        spinner.fail(`Write failed: ${(err as Error).message}`);
        process.exit(1);
    }

    // Summary
    const budgetCount   = finalRecords.filter(r => r.priceRange === 'budget').length;
    const midCount      = finalRecords.filter(r => r.priceRange === 'mid-range').length;
    const upscaleCount  = finalRecords.filter(r => r.priceRange === 'upscale').length;
    const fineCount     = finalRecords.filter(r => r.priceRange === 'fine-dining').length;
    const deliveryCount = finalRecords.filter(r => r.serviceOptions?.delivery).length;
    const mergedCount   = finalRecords.filter(r => r.dataSource === 'merged').length;

    console.log(chalk.cyan.bold('\nSummary'));
    console.log(`  City          : ${city}`);
    console.log(`  CSV rows      : ${parsedTotal.toLocaleString()}`);
    console.log(`  Valid records : ${validRecords.length.toLocaleString()}`);
    console.log(`  After dedup   : ${deduped.length.toLocaleString()}`);
    console.log(`  Final output  : ${finalRecords.length.toLocaleString()}`);
    if (!options.skipOsm) console.log(`  OSM enriched  : ${mergedCount.toLocaleString()}`);
    console.log('');
    console.log(chalk.cyan('Price distribution'));
    console.log(`  Budget        : ${budgetCount}`);
    console.log(`  Mid-range     : ${midCount}`);
    console.log(`  Upscale       : ${upscaleCount}`);
    console.log(`  Fine dining   : ${fineCount}`);
    console.log('');
    console.log(chalk.cyan('Service options'));
    console.log(`  Has delivery  : ${deliveryCount}`);
    console.log('');
    console.log(chalk.green(`Output written to: ${outputPath}`));
}
