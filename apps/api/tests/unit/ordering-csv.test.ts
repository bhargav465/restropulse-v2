import { describe, test, expect } from 'vitest';
import { parseMenuCsv } from '../../src/services/ordering/menu-csv.js';

const HEADER = 'category,name,description,price,isVeg,availability,images,variants,addons,sortOrder';

describe('parseMenuCsv', () => {
    test('parses valid rows with variants, addons and images', () => {
        const csv = [
            HEADER,
            'Mains,Butter Chicken,Rich tomato gravy,380,false,in_stock,https://a.jpg|https://b.jpg,Half:240|Full:380,Extra Butter:30,1',
            'Breads,Butter Naan,,60,true,,,,,2',
        ].join('\n');

        const { rows, errors } = parseMenuCsv(csv);

        expect(errors).toHaveLength(0);
        expect(rows).toHaveLength(2);

        const bc = rows[0];
        expect(bc.category).toBe('Mains');
        expect(bc.name).toBe('Butter Chicken');
        expect(bc.price).toBe(380);
        expect(bc.isVeg).toBe(false);
        expect(bc.availability).toBe('in_stock');
        expect(bc.images).toEqual(['https://a.jpg', 'https://b.jpg']);
        expect(bc.variants.map((v) => ({ name: v.name, price: v.price }))).toEqual([
            { name: 'Half', price: 240 },
            { name: 'Full', price: 380 },
        ]);
        expect(bc.variants[0].id).toBeTruthy();
        expect(bc.addons).toHaveLength(1);
        expect(bc.sortOrder).toBe(1);

        const naan = rows[1];
        expect(naan.isVeg).toBe(true);
        expect(naan.availability).toBe('in_stock'); // defaults when blank
        expect(naan.description).toBeUndefined();
        expect(naan.variants).toHaveLength(0);
    });

    test('accepts veg/non-veg spellings for isVeg', () => {
        const csv = [HEADER, 'Mains,A,,10,veg,,,,,', 'Mains,B,,10,non-veg,,,,,'].join('\n');
        const { rows, errors } = parseMenuCsv(csv);
        expect(errors).toHaveLength(0);
        expect(rows[0].isVeg).toBe(true);
        expect(rows[1].isVeg).toBe(false);
    });

    test('reports per-row errors and keeps parsing the good rows', () => {
        const csv = [
            HEADER,
            ',Missing Category,,100,true,in_stock,,,,',           // row 1: no category
            'Mains,,,100,true,in_stock,,,,',                       // row 2: no name
            'Mains,Bad Price,,abc,true,in_stock,,,,',              // row 3: bad price
            'Mains,Bad Veg,,100,maybe,in_stock,,,,',               // row 4: bad isVeg
            'Mains,Bad Availability,,100,true,sometimes,,,,',      // row 5: bad availability
            'Mains,Bad Variant,,100,true,in_stock,,HalfOnly,,',    // row 6: malformed variant
            'Mains,Good Row,,120,true,in_stock,,,,3',              // row 7: valid
        ].join('\n');

        const { rows, errors } = parseMenuCsv(csv);

        expect(rows).toHaveLength(1);
        expect(rows[0].name).toBe('Good Row');
        expect(rows[0].row).toBe(7);

        expect(errors).toHaveLength(6);
        expect(errors.map((e) => e.row)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(errors[0].errors[0]).toMatch(/category is required/);
        expect(errors[1].errors[0]).toMatch(/name is required/);
        expect(errors[2].errors[0]).toMatch(/price/);
        expect(errors[3].errors[0]).toMatch(/isVeg/);
        expect(errors[4].errors[0]).toMatch(/availability/);
        expect(errors[5].errors[0]).toMatch(/variants/);
    });

    test('collects multiple errors on the same row', () => {
        const csv = [HEADER, ',,,-5,maybe,nowhere,,,,'].join('\n');
        const { rows, errors } = parseMenuCsv(csv);
        expect(rows).toHaveLength(0);
        expect(errors).toHaveLength(1);
        expect(errors[0].errors.length).toBeGreaterThanOrEqual(4);
    });

    test('rejects negative prices', () => {
        const csv = [HEADER, 'Mains,Freebie,,-1,true,in_stock,,,,'].join('\n');
        const { errors } = parseMenuCsv(csv);
        expect(errors).toHaveLength(1);
        expect(errors[0].errors[0]).toMatch(/non-negative/);
    });

    test('handles empty input and header-only input', () => {
        expect(parseMenuCsv('')).toEqual({ rows: [], errors: [] });
        expect(parseMenuCsv(HEADER)).toEqual({ rows: [], errors: [] });
    });

    test('is case-insensitive for headers and accepts Buffer input', () => {
        const csv = Buffer.from(['Category,Name,Price,IsVeg', 'Mains,Dal,180,true'].join('\n'));
        const { rows, errors } = parseMenuCsv(csv);
        expect(errors).toHaveLength(0);
        expect(rows[0].name).toBe('Dal');
        expect(rows[0].price).toBe(180);
    });

    test('throws when required header columns are missing', () => {
        expect(() => parseMenuCsv('name,price\nDal,180')).toThrowError(/missing required column "category"/);
    });

    test('addon name containing a colon uses the last colon as separator', () => {
        const csv = [HEADER, 'Mains,Dal,,180,true,in_stock,,,Note: Spicy:20,'].join('\n');
        const { rows, errors } = parseMenuCsv(csv);
        expect(errors).toHaveLength(0);
        expect(rows[0].addons[0]).toMatchObject({ name: 'Note: Spicy', price: 20 });
    });
});
