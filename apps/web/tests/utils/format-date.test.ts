import { describe, it, expect } from 'vitest';
import { formatCalendarDate } from '../../utils/format-date';

describe('formatCalendarDate', () => {
    it('keeps a date-only value on the same calendar day in any timezone', () => {
        const out = formatCalendarDate('2024-01-15', 'en-US');
        expect(out).toBe('1/15/2024');
    });

    it('respects the requested locale', () => {
        expect(formatCalendarDate('2024-01-15', 'en-GB')).toBe('15/01/2024');
    });

    it('formats full timestamps as instants', () => {
        const iso = '2024-03-10T12:00:00.000Z';
        expect(formatCalendarDate(iso, 'en-US')).toBe(new Date(iso).toLocaleDateString('en-US'));
    });
});
