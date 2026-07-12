/**
 * Unit tests for the shared intelligence atoms: ScoreDial, PillarBar,
 * ProvenanceChip (DESIGN §3/§5).
 */
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from './utils/test-utils';
import type { PillarScore } from '@restropulse/shared';
import { ScoreDial, PillarBar } from '../components/v2/intelligence/primitives';
import { ProvenanceChip } from '../components/v2/intelligence/provenance';

describe('ScoreDial', () => {
    test('renders the score, grade and an accessible label', () => {
        render(<ScoreDial score={68} grade="C" />);
        expect(screen.getByText('68')).toBeInTheDocument();
        expect(screen.getByText(/Grade C/)).toBeInTheDocument();
        expect(screen.getByRole('img', { name: /RestroScore 68 out of 100, grade C/i })).toBeInTheDocument();
    });

    test('shows the delta vs last scan when provided', () => {
        render(<ScoreDial score={68} grade="C" delta={3} />);
        expect(screen.getByText(/\+3 vs last scan/)).toBeInTheDocument();
    });
});

describe('PillarBar', () => {
    const pillar: PillarScore = { key: 'website', score: 34, grade: 'F', provenance: 'measured', checks: [] };

    test('renders the pillar label and grade', () => {
        render(<PillarBar pillar={pillar} />);
        expect(screen.getByText('Website')).toBeInTheDocument();
        expect(screen.getByText('F')).toBeInTheDocument();
    });

    test('calls onSelect with the pillar key when clicked', () => {
        const onSelect = vi.fn();
        render(<PillarBar pillar={pillar} onSelect={onSelect} />);
        fireEvent.click(screen.getByRole('button'));
        expect(onSelect).toHaveBeenCalledWith('website');
    });
});

describe('ProvenanceChip', () => {
    test('measured chip shows the source', () => {
        render(<ProvenanceChip provenance="measured" source="Google" />);
        expect(screen.getByText('Measured')).toBeInTheDocument();
        expect(screen.getByText('(Google)')).toBeInTheDocument();
    });

    test('computed chip', () => {
        render(<ProvenanceChip provenance="computed" />);
        expect(screen.getByText('Computed')).toBeInTheDocument();
    });

    test('ai-inferred chip labels "AI estimate" with a dashed border (honest data rule)', () => {
        render(<ProvenanceChip provenance="ai-inferred" />);
        const chip = screen.getByText('AI estimate');
        expect(chip).toBeInTheDocument();
        expect(chip.className).toMatch(/border-dashed/);
    });
});
