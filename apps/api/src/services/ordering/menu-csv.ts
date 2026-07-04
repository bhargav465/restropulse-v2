/**
 * CSV parser for bulk menu upload (v1).
 *
 * Expected header columns (case-insensitive):
 *   category,name,description,price,isVeg,availability,images,variants,addons,sortOrder
 *
 * - images:   pipe-separated URLs                e.g. "https://a.jpg|https://b.jpg"
 * - variants: pipe-separated Name:price pairs    e.g. "Half:120|Full:220"
 * - addons:   pipe-separated Name:price pairs    e.g. "Extra Cheese:40"
 *
 * Pure parsing/validation — unit tested in tests/unit/ordering-csv.test.ts.
 */

import { randomUUID } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import type { MenuItemAddon, MenuItemAvailability, MenuItemVariant } from '@restropulse/shared';

export interface ParsedMenuCsvRow {
    /** 1-based data row number (excluding the header row). */
    row: number;
    category: string;
    name: string;
    description?: string;
    price: number;
    isVeg: boolean;
    availability: MenuItemAvailability;
    images: string[];
    variants: MenuItemVariant[];
    addons: MenuItemAddon[];
    sortOrder?: number;
}

export interface MenuCsvRowError {
    row: number;
    errors: string[];
}

export interface MenuCsvParseResult {
    rows: ParsedMenuCsvRow[];
    errors: MenuCsvRowError[];
}

const AVAILABILITIES: MenuItemAvailability[] = ['in_stock', 'out_of_stock', 'hidden'];
const TRUTHY = ['true', 'yes', 'veg', '1', 'y'];
const FALSY = ['false', 'no', 'non-veg', 'nonveg', 'non_veg', '0', 'n'];

function parseNamePricePairs(raw: string, label: string, errors: string[]): Array<{ id: string; name: string; price: number }> {
    if (!raw.trim()) return [];
    const out: Array<{ id: string; name: string; price: number }> = [];
    for (const pair of raw.split('|')) {
        const idx = pair.lastIndexOf(':');
        const name = idx === -1 ? '' : pair.slice(0, idx).trim();
        const priceRaw = idx === -1 ? '' : pair.slice(idx + 1).trim();
        const price = Number(priceRaw);
        if (!name || priceRaw === '' || !Number.isFinite(price) || price < 0) {
            errors.push(`Invalid ${label} entry "${pair.trim()}" — expected "Name:price"`);
            continue;
        }
        out.push({ id: randomUUID(), name, price });
    }
    return out;
}

/**
 * Parses and validates a menu CSV. Never throws for row-level problems —
 * invalid rows are reported in `errors` and valid rows returned in `rows`.
 * @throws Error only when the CSV itself is malformed (e.g. bad quoting) or
 *         required header columns are missing.
 */
export function parseMenuCsv(input: string | Buffer): MenuCsvParseResult {
    const records = parse(input, {
        columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: true,
    }) as Array<Record<string, string>>;

    if (records.length > 0) {
        const cols = Object.keys(records[0]);
        for (const required of ['category', 'name', 'price']) {
            if (!cols.includes(required)) {
                throw new Error(`CSV is missing required column "${required}"`);
            }
        }
    }

    const rows: ParsedMenuCsvRow[] = [];
    const errors: MenuCsvRowError[] = [];

    records.forEach((record, i) => {
        const rowNumber = i + 1;
        const rowErrors: string[] = [];

        const category = (record.category ?? '').trim();
        const name = (record.name ?? '').trim();
        if (!category) rowErrors.push('category is required');
        if (!name) rowErrors.push('name is required');

        const price = Number((record.price ?? '').trim());
        if ((record.price ?? '').trim() === '' || !Number.isFinite(price) || price < 0) {
            rowErrors.push('price must be a non-negative number');
        }

        const isVegRaw = (record.isveg ?? '').trim().toLowerCase();
        let isVeg = false;
        if (TRUTHY.includes(isVegRaw)) isVeg = true;
        else if (FALSY.includes(isVegRaw)) isVeg = false;
        else rowErrors.push('isVeg must be true/false (or veg/non-veg)');

        const availabilityRaw = (record.availability ?? '').trim().toLowerCase();
        const availability = (availabilityRaw || 'in_stock') as MenuItemAvailability;
        if (!AVAILABILITIES.includes(availability)) {
            rowErrors.push(`availability must be one of: ${AVAILABILITIES.join(', ')}`);
        }

        const sortOrderRaw = (record.sortorder ?? '').trim();
        let sortOrder: number | undefined;
        if (sortOrderRaw !== '') {
            sortOrder = Number(sortOrderRaw);
            if (!Number.isFinite(sortOrder)) rowErrors.push('sortOrder must be a number');
        }

        const images = (record.images ?? '').split('|').map((s) => s.trim()).filter(Boolean);
        const variants = parseNamePricePairs(record.variants ?? '', 'variants', rowErrors);
        const addons = parseNamePricePairs(record.addons ?? '', 'addons', rowErrors);

        if (rowErrors.length > 0) {
            errors.push({ row: rowNumber, errors: rowErrors });
            return;
        }

        rows.push({
            row: rowNumber,
            category,
            name,
            description: (record.description ?? '').trim() || undefined,
            price,
            isVeg,
            availability,
            images,
            variants,
            addons,
            sortOrder,
        });
    });

    return { rows, errors };
}
