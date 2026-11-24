import { describe, test, expect } from 'vitest';
import { parseMenuCsv, readCsv, MAX_MENU_CSV_ROWS } from '../../src/services/cms/menu-csv.js';

const HEADER = 'category,name,description,price,isVeg,availability,images,variants,addons,sortOrder';

describe('readCsv', () => {
    test('handles quotes, escaped quotes, embedded newlines, CRLF and BOM', () => {
        const text = '﻿a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n\r\n1,2,3';
        expect(readCsv(text)).toEqual([
            ['a', 'b', 'c'],
            ['x, y', 'say "hi"', 'line1\nline2'],
            ['1', '2', '3'],
        ]);
    });

    test('handles a lone CR line break and a trailing field', () => {
        expect(readCsv('a,b\rc,')).toEqual([['a', 'b'], ['c', '']]);
    });

    test('throws on an unterminated quote', () => {
        expect(() => readCsv('a,"b\n1,2')).toThrow(/unterminated/);
    });
});

describe('parseMenuCsv', () => {
    test('parses valid rows with variants, addons and images', () => {
        const csv = [
            HEADER,
            'Mains,Butter Chicken,Rich tomato gravy,380,false,in_stock,https://a.jpg|https://b.jpg,Half:240|Full:380,Extra Butter:30,1',
            'Breads,Butter Naan,,60,true,,,,,2',
        ].join('\n');

        const { rows, errors } = parseMenuCsv(Buffer.from(csv));
        expect(errors).toHaveLength(0);
        expect(rows).toHaveLength(2);

        const bc = rows[0];
        expect(bc).toMatchObject({ row: 1, category: 'Mains', name: 'Butter Chicken', price: 380, isVeg: false, availability: 'in_stock', sortOrder: 1 });
        expect(bc.images).toEqual(['https://a.jpg', 'https://b.jpg']);
        expect(bc.variants.map((v) => ({ name: v.name, price: v.price }))).toEqual([
            { name: 'Half', price: 240 },
            { name: 'Full', price: 380 },
        ]);
        expect(bc.variants[0].id).toBeTruthy();
        expect(bc.addons).toHaveLength(1);

        const naan = rows[1];
        expect(naan.isVeg).toBe(true);
        expect(naan.availability).toBe('in_stock');
        expect(naan.description).toBeUndefined();
        expect(naan.variants).toHaveLength(0);
    });

    test('accepts header columns in any order and case', () => {
        const { rows, errors } = parseMenuCsv('Price,NAME,Category,isVeg\n10,Chai,Drinks,veg');
        expect(errors).toEqual([]);
        expect(rows[0]).toMatchObject({ name: 'Chai', category: 'Drinks', price: 10, isVeg: true });
    });

    test('accepts veg/non-veg spellings for isVeg', () => {
        const { rows, errors } = parseMenuCsv([HEADER, 'Mains,A,,10,veg,,,,,', 'Mains,B,,10,non-veg,,,,,'].join('\n'));
        expect(errors).toHaveLength(0);
        expect(rows.map((r) => r.isVeg)).toEqual([true, false]);
    });

    test('reports per-row errors and keeps the good rows', () => {
        const csv = [
            HEADER,
            ',,,abc,maybe,soldout,http://insecure.jpg,Half,Cheese:-1,x',
            'Mains,Dal,,120,true,,,,,',
            'Mains,Dal,,130,true,,,,,',
        ].join('\n');
        const { rows, errors } = parseMenuCsv(csv);
        expect(rows.map((r) => r.name)).toEqual(['Dal']);
        expect(errors).toHaveLength(2);
        expect(errors[0].row).toBe(1);
        expect(errors[0].errors).toEqual(expect.arrayContaining([
            'category is required',
            'name is required',
            'price must be a non-negative number',
            'isVeg must be true/false (or veg/non-veg)',
            expect.stringMatching(/^availability must be one of/),
            'sortOrder must be a number',
            'images must be https:// URLs',
            expect.stringMatching(/^Invalid variants entry "Half"/),
            expect.stringMatching(/^Invalid addons entry "Cheese:-1"/),
        ]));
        expect(errors[1]).toEqual({ row: 3, errors: ['"Dal" appears earlier in this file'] });
    });

    test('throws on a missing required column', () => {
        expect(() => parseMenuCsv('category,name\nMains,Dal')).toThrow('CSV is missing required column "price"');
    });

    test('returns nothing for an empty file', () => {
        expect(parseMenuCsv('')).toEqual({ rows: [], errors: [] });
    });

    test('rejects files over the row cap', () => {
        const csv = ['category,name,price', ...Array.from({ length: MAX_MENU_CSV_ROWS + 1 }, (_, i) => `C,Item ${i},1`)].join('\n');
        expect(() => parseMenuCsv(csv)).toThrow(/limit is/);
    });
});
