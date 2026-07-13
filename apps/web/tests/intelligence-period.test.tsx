/**
 * BucketSwitch + PeriodFilter param mapping (Brief 09 §5). The preset → query
 * mapping is the load-bearing contract with BRIEF-07; assert exact objects.
 */
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from './utils/test-utils';
import {
    minePeriodQuery,
    competitionPeriodQuery,
    mineQuery,
    competitionQuery,
    compareParamsFor,
    defaultMineSelection,
    defaultCompetitionSelection,
} from '../components/v2/intelligence/period';
import { BucketSwitch } from '../components/v2/intelligence/BucketSwitch';
import { PeriodFilter } from '../components/v2/intelligence/PeriodFilter';

const NOW = new Date('2026-07-12T09:00:00.000Z');

describe('period mapping (My Restaurant)', () => {
    test('MTD → month-to-date day range', () => {
        expect(minePeriodQuery('MTD', '2026-07-05', NOW)).toEqual({
            from: '2026-07-01',
            to: '2026-07-12',
            granularity: 'day',
        });
    });
    test('DATE → single-day range from the picker', () => {
        expect(minePeriodQuery('DATE', '2026-06-03', NOW)).toEqual({
            from: '2026-06-03',
            to: '2026-06-03',
            granularity: 'day',
        });
    });
    test('OVERALL → month granularity, no from/to', () => {
        expect(minePeriodQuery('OVERALL', '2026-07-05', NOW)).toEqual({ granularity: 'month' });
    });
});

describe('period mapping (Competition)', () => {
    test('DAY → single-day range', () => {
        expect(competitionPeriodQuery('DAY', '2026-07-02', NOW)).toEqual({
            from: '2026-07-02',
            to: '2026-07-02',
            granularity: 'day',
        });
    });
    test('MONTH → month range with -01/-31 bounds', () => {
        expect(competitionPeriodQuery('MONTH', '2026-05', NOW)).toEqual({
            from: '2026-05-01',
            to: '2026-05-31',
            granularity: 'month',
        });
    });
});

describe('compareParamsFor', () => {
    test('day query → { granularity:day, date }', () => {
        expect(compareParamsFor({ from: '2026-07-02', to: '2026-07-02', granularity: 'day' })).toEqual({
            granularity: 'day',
            date: '2026-07-02',
        });
    });
    test('month query → { granularity:month, month }', () => {
        expect(compareParamsFor({ from: '2026-05-01', to: '2026-05-31', granularity: 'month' })).toEqual({
            granularity: 'month',
            month: '2026-05',
        });
    });
});

describe('BucketSwitch', () => {
    test('toggles between the two buckets', () => {
        const onChange = vi.fn();
        render(<BucketSwitch value="MINE" onChange={onChange} />);
        fireEvent.click(screen.getByRole('tab', { name: 'Competition' }));
        expect(onChange).toHaveBeenCalledWith('COMPETITION');
        const mine = screen.getByRole('tab', { name: 'My Restaurant' });
        expect(mine).toHaveAttribute('aria-selected', 'true');
    });
});

describe('PeriodFilter emits selections that map to exact queries', () => {
    test('My Restaurant: picking Overall maps to month granularity', () => {
        const onChange = vi.fn();
        render(<PeriodFilter bucket="MINE" selection={defaultMineSelection(NOW)} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Overall' }));
        const next = onChange.mock.calls[0][0];
        expect(mineQuery(next, NOW)).toEqual({ granularity: 'month' });
    });

    test('My Restaurant: Specific date reveals a date input and maps to a single day', () => {
        const sel = { preset: 'DATE' as const, date: '2026-06-03' };
        const onChange = vi.fn();
        render(<PeriodFilter bucket="MINE" selection={sel} onChange={onChange} />);
        expect(screen.getByLabelText('Pick a date')).toBeInTheDocument();
        expect(mineQuery(sel, NOW)).toEqual({ from: '2026-06-03', to: '2026-06-03', granularity: 'day' });
    });

    test('Competition: switching to Month maps to a month range', () => {
        const onChange = vi.fn();
        render(<PeriodFilter bucket="COMPETITION" selection={defaultCompetitionSelection(NOW)} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Month' }));
        const next = onChange.mock.calls[0][0];
        expect(competitionQuery(next, NOW)).toEqual({
            from: '2026-07-01',
            to: '2026-07-31',
            granularity: 'month',
        });
    });
});
