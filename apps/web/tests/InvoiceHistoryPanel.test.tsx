import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import InvoiceHistoryPanel from '../components/InvoiceHistoryPanel';
import type { Invoice } from '@restropulse/shared';

const makeInvoice = (overrides: Partial<Invoice> & { id: string }): Invoice => ({
    restaurantId: 'r1',
    type: 'SUBSCRIPTION',
    amountPaise: 49900,
    currency: 'INR',
    status: 'paid',
    description: 'Growth Plan - Monthly',
    paidAt: new Date('2025-11-01').toISOString(),
    ...overrides,
});

const sub1 = makeInvoice({ id: 'inv-1', description: 'Growth Plan - Monthly', paidAt: new Date('2025-11-01').toISOString() });
const sub2 = makeInvoice({ id: 'inv-2', description: 'Growth Plan - Monthly', paidAt: new Date('2025-10-01').toISOString() });
const credit1 = makeInvoice({ id: 'inv-3', type: 'CREDIT_PURCHASE', description: 'Credit Pack - 50 credits', amountPaise: 19900, paidAt: new Date('2025-09-15').toISOString() });
const oldSub = makeInvoice({ id: 'inv-4', description: 'Starter Plan - Monthly', paidAt: new Date('2024-05-01').toISOString() });

describe('InvoiceHistoryPanel', () => {
    it('renders all invoices by default', () => {
        render(<InvoiceHistoryPanel invoices={[sub1, sub2, credit1]} onClose={vi.fn()} />);
        expect(screen.getAllByText('Growth Plan - Monthly')).toHaveLength(2);
        expect(screen.getByText('Credit Pack - 50 credits')).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('filters to subscriptions only', () => {
        render(<InvoiceHistoryPanel invoices={[sub1, sub2, credit1]} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Plans' }));
        expect(screen.getAllByText('Growth Plan - Monthly')).toHaveLength(2);
        expect(screen.queryByText('Credit Pack - 50 credits')).not.toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('filters to credits only', () => {
        render(<InvoiceHistoryPanel invoices={[sub1, sub2, credit1]} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Credits' }));
        expect(screen.getByText('Credit Pack - 50 credits')).toBeInTheDocument();
        expect(screen.queryByText('Growth Plan - Monthly')).not.toBeInTheDocument();
        expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('groups invoices by year when spanning multiple years', () => {
        render(<InvoiceHistoryPanel invoices={[sub1, oldSub]} onClose={vi.fn()} />);
        expect(screen.getByText('2025')).toBeInTheDocument();
        expect(screen.getByText('2024')).toBeInTheDocument();
    });

    it('does not show year headers for single-year list', () => {
        render(<InvoiceHistoryPanel invoices={[sub1, sub2]} onClose={vi.fn()} />);
        expect(screen.queryByText('2025')).not.toBeInTheDocument();
    });

    it('shows Show more button and loads more on click', () => {
        const many = Array.from({ length: 15 }, (_, i) =>
            makeInvoice({ id: `inv-${i}`, description: `Plan ${i}`, paidAt: new Date(`2025-${String(i % 12 + 1).padStart(2, '0')}-01`).toISOString() })
        );
        render(<InvoiceHistoryPanel invoices={many} onClose={vi.fn()} />);
        expect(screen.getByText(/Show more/)).toBeInTheDocument();
        fireEvent.click(screen.getByText(/Show more/));
        expect(screen.queryByText(/Show more/)).not.toBeInTheDocument();
    });

    it('resets visible count when filter changes', () => {
        // 12 subscriptions + 3 credits = 15 total; Show more visible on All tab
        const subs = Array.from({ length: 12 }, (_, i) =>
            makeInvoice({ id: `sub-${i}`, type: 'SUBSCRIPTION', description: `Plan ${i}`, paidAt: new Date(`2025-${String(i % 12 + 1).padStart(2, '0')}-01`).toISOString() })
        );
        const credits = Array.from({ length: 3 }, (_, i) =>
            makeInvoice({ id: `cred-${i}`, type: 'CREDIT_PURCHASE', description: `Credits ${i}`, paidAt: new Date('2025-01-01').toISOString() })
        );
        render(<InvoiceHistoryPanel invoices={[...subs, ...credits]} onClose={vi.fn()} />);
        // expand All tab
        fireEvent.click(screen.getByText(/Show more/));
        // switch to Credits (only 3 items — no Show more needed)
        fireEvent.click(screen.getByRole('button', { name: 'Credits' }));
        expect(screen.queryByText(/Show more/)).not.toBeInTheDocument();
    });

    it('shows pdf download link when pdfUrl is present', () => {
        const withPdf = makeInvoice({ id: 'inv-pdf', pdfUrl: 'https://rzp.io/i/abc123' });
        render(<InvoiceHistoryPanel invoices={[withPdf]} onClose={vi.fn()} />);
        const link = screen.getByTitle('Download Invoice');
        expect(link).toHaveAttribute('href', 'https://rzp.io/i/abc123');
        expect(link).toHaveAttribute('target', '_blank');
    });

    it('does not show download link when pdfUrl is absent', () => {
        render(<InvoiceHistoryPanel invoices={[sub1]} onClose={vi.fn()} />);
        expect(screen.queryByTitle('Download Invoice')).not.toBeInTheDocument();
    });

    it('calls onClose when the backdrop is clicked', () => {
        const onClose = vi.fn();
        render(<InvoiceHistoryPanel invoices={[sub1]} onClose={onClose} />);
        fireEvent.click(screen.getByTestId('invoice-backdrop'));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('shows empty state when no invoices match filter', () => {
        render(<InvoiceHistoryPanel invoices={[sub1]} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Credits' }));
        expect(screen.getByText('No invoices')).toBeInTheDocument();
    });
});
