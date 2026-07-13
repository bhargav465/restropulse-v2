/**
 * Revenue-growth card (Brief 10 §2) — 9% uplift math is exact, the guests input
 * clamps to [400, 8000], defaults come from clamp(reviews×2, …), and the surface
 * carries no pill deltas (it is a projection, not a promise).
 */
import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent } from './utils/test-utils';
import type { IntelligenceReport } from '@restropulse/shared';
import RevenueCard, { defaultGuests, GUESTS_MIN, GUESTS_MAX } from '../components/v2/intelligence/my-restaurant/RevenueCard';
import { DEMO_INTELLIGENCE_REPORT } from '../lib/demo-fixtures-intelligence';

function reportWithReviews(reviews: number): IntelligenceReport {
    return { ...DEMO_INTELLIGENCE_REPORT, base: { ...DEMO_INTELLIGENCE_REPORT.base, totalRatings: reviews } };
}

describe('defaultGuests clamp', () => {
    test('reviews×2 within bounds', () => {
        expect(defaultGuests(1000)).toBe(2000);
    });
    test('clamps low to GUESTS_MIN', () => {
        expect(defaultGuests(10)).toBe(GUESTS_MIN);
    });
    test('clamps high to GUESTS_MAX', () => {
        expect(defaultGuests(100000)).toBe(GUESTS_MAX);
    });
});

describe('RevenueCard', () => {
    test('9% math is exact for the defaults (guests 2000, ₹400)', () => {
        // reviews 1000 → guests 2000; 9% → 180 guests; ×₹400 = ₹72,000/mo; ×12 = ₹864,000/yr.
        render(<RevenueCard report={reportWithReviews(1000)} />);
        expect(screen.getByText('+180')).toBeInTheDocument();
        expect(screen.getByText('₹72,000')).toBeInTheDocument();
        expect(screen.getByText('₹8,64,000')).toBeInTheDocument();
    });

    test('recomputes when the average spend changes', () => {
        render(<RevenueCard report={reportWithReviews(1000)} />);
        fireEvent.change(screen.getByLabelText('Average spend'), { target: { value: '500' } });
        // 180 guests × ₹500 = ₹90,000/mo
        expect(screen.getByText('₹90,000')).toBeInTheDocument();
    });

    test('guests input clamps above the max', () => {
        render(<RevenueCard report={reportWithReviews(1000)} />);
        const guests = screen.getByLabelText('Guests per month') as HTMLInputElement;
        fireEvent.change(guests, { target: { value: '999999' } });
        expect(guests.value).toBe(String(GUESTS_MAX));
    });

    test('carries no delta-pill markup (projection, not a promise)', () => {
        const { container } = render(<RevenueCard report={reportWithReviews(1000)} />);
        // The delta pills used elsewhere are ▲/▼ glyphs; the card must not use them.
        expect(container.textContent).not.toMatch(/[▲▼]/);
    });
});
