/**
 * CSV parser for bulk menu upload.
 *
 * Expected header columns (case-insensitive, any order):
 *   category,name,description,price,isVeg,availability,images,variants,addons,sortOrder
 * Required: category, name, price.
 *
 * - images:   pipe-separated URLs                e.g. "https://a.jpg|https://b.jpg"
 * - variants: pipe-separated Name:price pairs    e.g. "Half:120|Full:220"
 * - addons:   pipe-separated Name:price pairs    e.g. "Extra Cheese:40"
 *
 * Same contract as the Vercel line's parser (origin/feat/vercel-deploy,
 * services/ordering/menu-csv.ts) but with a small built-in RFC 4180 reader so
 * the API takes no new dependency. Pure -- unit tested in tests/unit/cms-menu-csv.test.ts.
 */

import { randomUUID } from 'node:crypto';
import type { MenuItemAddon, MenuItemAvailability, MenuItemVariant } from '@restropulse/shared';
import { MENU_ITEM_AVAILABILITIES } from '@restropulse/shared';

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

/** Hard cap so one upload can't turn into an unbounded write loop. */
export const MAX_MENU_CSV_ROWS = 2000;

const TRUTHY = ['true', 'yes', 'veg', '1', 'y'];
const FALSY = ['false', 'no', 'non-veg', 'nonveg', 'non_veg', '0', 'n'];

/**
 * Minimal RFC 4180 reader: commas, double-quoted fields with "" escapes,
 * CRLF/LF/CR line breaks (also inside quotes), leading BOM. Blank lines dropped.
 * @throws Error on an unterminated quoted field.
 */
export function readCsv(text: string): string[][] {
    const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    let i = 0;

    const endField = () => { row.push(field); field = ''; };
    const endRow = () => {
        endField();
        if (row.some((f) => f.trim() !== '')) rows.push(row);
        row = [];
    };

    while (i < input.length) {
        const ch = input[i];
        if (inQuotes) {
            if (ch === '"') {
                if (input[i + 1] === '"') { field += '"'; i += 2; continue; }
                inQuotes = false; i += 1; continue;
            }
            field += ch; i += 1; continue;
        }
        if (ch === '"' && field.trim() === '') { field = ''; inQuotes = true; i += 1; continue; }
        if (ch === ',') { endField(); i += 1; continue; }
        if (ch === '\r' || ch === '\n') {
            endRow();
            i += ch === '\r' && input[i + 1] === '\n' ? 2 : 1;
            continue;
        }
        field += ch; i += 1;
    }
    if (inQuotes) throw new Error('CSV has an unterminated quoted field');
    if (field !== '' || row.length > 0) endRow();
    return rows;
}

function parseNamePricePairs(raw: string, label: string, errors: string[]): Array<{ id: string; name: string; price: number }> {
    if (!raw.trim()) return [];
    const out: Array<{ id: string; name: string; price: number }> = [];
    for (const pair of raw.split('|')) {
        const idx = pair.lastIndexOf(':');
        const name = idx === -1 ? '' : pair.slice(0, idx).trim();
        const priceRaw = idx === -1 ? '' : pair.slice(idx + 1).trim();
        const price = Number(priceRaw);
        if (!name || priceRaw === '' || !Number.isFinite(price) || price < 0) {
            errors.push(`Invalid ${label} entry "${pair.trim()}", expected "Name:price"`);
            continue;
        }
        out.push({ id: randomUUID(), name: name.slice(0, 80), price });
    }
    return out;
}

/**
 * Parses and validates a menu CSV. Never throws for row-level problems:
 * invalid rows are reported in `errors` and valid rows returned in `rows`.
 * A name repeated within the file is an error on the later row.
 * @throws Error when the CSV is malformed, required header columns are missing,
 *         or it has more than MAX_MENU_CSV_ROWS data rows.
 */
export function parseMenuCsv(input: string | Buffer): MenuCsvParseResult {
    const table = readCsv(typeof input === 'string' ? input : input.toString('utf8'));
    if (table.length === 0) return { rows: [], errors: [] };

    const header = table[0].map((h) => h.trim().toLowerCase());
    for (const required of ['category', 'name', 'price']) {
        if (!header.includes(required)) throw new Error(`CSV is missing required column "${required}"`);
    }
    const dataRows = table.slice(1);
    if (dataRows.length > MAX_MENU_CSV_ROWS) {
        throw new Error(`CSV has ${dataRows.length} rows; the limit is ${MAX_MENU_CSV_ROWS}`);
    }

    const rows: ParsedMenuCsvRow[] = [];
    const errors: MenuCsvRowError[] = [];
    const seenNames = new Set<string>();

    dataRows.forEach((cells, i) => {
        const record: Record<string, string> = {};
        header.forEach((col, idx) => { record[col] = (cells[idx] ?? '').trim(); });
        const rowNumber = i + 1;
        const rowErrors: string[] = [];

        const category = record.category ?? '';
        const name = record.name ?? '';
        if (!category) rowErrors.push('category is required');
        if (!name) rowErrors.push('name is required');
        if (name && seenNames.has(name)) rowErrors.push(`"${name}" appears earlier in this file`);

        const priceRaw = record.price ?? '';
        const price = Number(priceRaw);
        if (priceRaw === '' || !Number.isFinite(price) || price < 0) {
            rowErrors.push('price must be a non-negative number');
        }

        const isVegRaw = (record.isveg ?? '').toLowerCase();
        let isVeg = false;
        if (TRUTHY.includes(isVegRaw)) isVeg = true;
        else if (!FALSY.includes(isVegRaw)) rowErrors.push('isVeg must be true/false (or veg/non-veg)');

        const availability = ((record.availability ?? '').toLowerCase() || 'in_stock') as MenuItemAvailability;
        if (!MENU_ITEM_AVAILABILITIES.includes(availability)) {
            rowErrors.push(`availability must be one of: ${MENU_ITEM_AVAILABILITIES.join(', ')}`);
        }

        const sortOrderRaw = record.sortorder ?? '';
        let sortOrder: number | undefined;
        if (sortOrderRaw !== '') {
            sortOrder = Number(sortOrderRaw);
            if (!Number.isFinite(sortOrder)) rowErrors.push('sortOrder must be a number');
        }

        const images = (record.images ?? '').split('|').map((s) => s.trim()).filter(Boolean);
        if (images.some((u) => !/^https:\/\//i.test(u))) rowErrors.push('images must be https:// URLs');
        const variants = parseNamePricePairs(record.variants ?? '', 'variants', rowErrors);
        const addons = parseNamePricePairs(record.addons ?? '', 'addons', rowErrors);

        if (rowErrors.length > 0) {
            errors.push({ row: rowNumber, errors: rowErrors });
            return;
        }
        seenNames.add(name);
        rows.push({
            row: rowNumber,
            category: category.slice(0, 80),
            name: name.slice(0, 120),
            description: record.description ? record.description.slice(0, 500) : undefined,
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
