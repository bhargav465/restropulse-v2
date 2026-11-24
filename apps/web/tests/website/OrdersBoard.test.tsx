import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '../utils/test-utils';
import WebsiteCms from '../../components/website/WebsiteCms';
import OrdersBoard, { mergeOrders, minutesSince, ORDERS_POLL_MS } from '../../components/website/OrdersBoard';
import OrderingSettings, { fromForm, toForm } from '../../components/website/OrderingSettings';
import { ordersAPI as demo, resetDemoOrders, _demoOrdersState } from '../../demo-api-orders';
import type { AdminOrder } from '../../api';

vi.mock('../../api', async () => ({
    cmsAPI: (await import('../../demo-api-cms')).cmsAPI,
    ordersAPI: (await import('../../demo-api-orders')).ordersAPI,
    sitesAPI: (await import('../../demo-api-sites')).sitesAPI,
}));

beforeEach(() => {
    resetDemoOrders();
    vi.restoreAllMocks();
});

afterEach(() => {
    vi.useRealTimers();
});

const card = (orderNumber: string) => screen.getByText(orderNumber).closest('div.rounded-2xl') as HTMLElement;

describe('helpers', () => {
    it('formats ages', () => {
        const now = Date.parse('2026-11-24T12:00:00Z');
        expect(minutesSince('2026-11-24T11:59:40Z', now)).toBe('just now');
        expect(minutesSince('2026-11-24T11:45:00Z', now)).toBe('15 min ago');
        expect(minutesSince('2026-11-24T09:00:00Z', now)).toBe('3 h ago');
        expect(minutesSince('2026-11-20T09:00:00Z', now)).toMatch(/20 Nov/);
    });

    it('merges changed orders newest first', () => {
        const a = { id: 'a', createdAt: '2026-11-24T10:00:00Z', status: 'RECEIVED' } as AdminOrder;
        const b = { id: 'b', createdAt: '2026-11-24T11:00:00Z', status: 'RECEIVED' } as AdminOrder;
        const merged = mergeOrders([a], [b, { ...a, status: 'PREPARING' }]);
        expect(merged.map((o) => o.id)).toEqual(['b', 'a']);
        expect(merged[1].status).toBe('PREPARING');
    });

    it('validates the settings form', () => {
        const form = toForm({ slug: null, suggestedSlug: 'demo-kitchen', onlinePaymentsAvailable: true, ordering: _demoOrdersState().ordering });
        expect(form.slug).toBe('demo-kitchen');
        expect(fromForm(form)).toMatchObject({ slug: 'demo-kitchen', ordering: { delivery: { freeAbove: 800 } } });
        expect(fromForm({ ...form, freeAbove: '' })).toMatchObject({ ordering: { delivery: { enabled: true, flatFee: 40, minOrder: 200 } } });
        expect((fromForm({ ...form, freeAbove: '' }) as { ordering: { delivery: object } }).ordering.delivery).not.toHaveProperty('freeAbove');
        expect(fromForm({ ...form, slug: 'No Spaces' })).toMatch(/lowercase letters/);
        expect(fromForm({ ...form, flatFee: 'abc' })).toBe('The delivery fee must be a number of 0 or more.');
        expect(fromForm({ ...form, taxRatePercent: '' })).toBe('Tax must be a number of 0 or more.');
        expect(fromForm({ ...form, freeAbove: '-1' })).toBe('Free delivery above must be a number of 0 or more.');
    });
});

describe('demo twin', () => {
    it('filters the feed and follows the status machine', async () => {
        expect((await demo.getFeed({ status: 'active' })).orders).toHaveLength(3);
        expect((await demo.getFeed({ status: 'completed' })).orders).toHaveLength(1);
        expect((await demo.getFeed({ status: 'all', limit: 2 })).orders).toHaveLength(2);
        expect((await demo.getFeed({ since: '2999-01-01T00:00:00Z' })).orders).toHaveLength(0);
        expect((await demo.getOrder('demo-ord-1')).orderNumber).toBe('RP-DEMO01');
        await expect(demo.getOrder('missing')).rejects.toThrow('Order not found');
        await expect(demo.setStatus('demo-ord-1', 'READY')).rejects.toThrow("isn't allowed");
        await expect(demo.setStatus('demo-ord-1', 'CANCELLED')).rejects.toThrow('Use cancel');
        expect((await demo.setStatus('demo-ord-1', 'PREPARING', 'on it')).statusHistory.at(-1)).toMatchObject({ status: 'PREPARING', note: 'on it' });
    });

    it('cancels with a refund only for paid online orders', async () => {
        expect(await demo.cancel('demo-ord-3', 'x')).toMatchObject({ refund: 'requested', order: { paymentStatus: 'refund_pending' } });
        expect((await demo.cancel('demo-ord-2', 'x')).refund).toBe('none');
        await expect(demo.cancel('demo-ord-4', 'x')).rejects.toThrow('no longer be cancelled');
    });

    it('saves settings with the same slug rules', async () => {
        await expect(demo.saveSettings({ slug: 'NO', ordering: _demoOrdersState().ordering })).rejects.toThrow('lowercase');
        const saved = await demo.saveSettings({ slug: 'new-place', ordering: { ..._demoOrdersState().ordering, taxRatePercent: 12 } });
        expect(saved).toMatchObject({ slug: 'new-place', ordering: { taxRatePercent: 12 } });
        expect((await demo.getSettings()).slug).toBe('new-place');
    });
});

describe('OrdersBoard', () => {
    it('shows open orders and moves one along', async () => {
        render(<OrdersBoard />);
        expect(await screen.findByText('RP-DEMO01')).toBeInTheDocument();
        expect(screen.queryByText('RP-DEMO04')).not.toBeInTheDocument();
        const first = card('RP-DEMO01');
        expect(within(first).getByText('Less spicy, please', { exact: false })).toBeInTheDocument();
        expect(within(first).getByText(/12 Road No\. 1/)).toBeInTheDocument();
        expect(within(first).getByText(/\(Half\)/)).toBeInTheDocument();
        fireEvent.click(within(first).getByRole('button', { name: 'Start preparing' }));
        await waitFor(() => expect(within(card('RP-DEMO01')).getByRole('button', { name: 'Mark ready' })).toBeInTheDocument());
        fireEvent.click(within(card('RP-DEMO01')).getByRole('button', { name: 'Mark ready' }));
        await waitFor(() => expect(within(card('RP-DEMO01')).getByRole('button', { name: 'Out for delivery' })).toBeInTheDocument());
    });

    it('completing an order removes it from the open view', async () => {
        render(<OrdersBoard />);
        await screen.findByText('RP-DEMO03');
        fireEvent.click(within(card('RP-DEMO03')).getByRole('button', { name: 'Complete' }));
        await waitFor(() => expect(screen.queryByText('RP-DEMO03')).not.toBeInTheDocument());
    });

    it('cancels a paid order with a refund and reports it', async () => {
        render(<OrdersBoard />);
        await screen.findByText('RP-DEMO03');
        fireEvent.click(within(card('RP-DEMO03')).getByRole('button', { name: 'Cancel order' }));
        const confirm = within(card('RP-DEMO03')).getByRole('button', { name: 'Confirm cancel' });
        expect(confirm).toBeDisabled();
        expect(within(card('RP-DEMO03')).getByRole('checkbox', { name: /Refund ₹441/ })).toBeChecked();
        fireEvent.change(within(card('RP-DEMO03')).getByLabelText('Reason'), { target: { value: 'Out of rice' } });
        fireEvent.click(within(card('RP-DEMO03')).getByRole('button', { name: 'Confirm cancel' }));
        expect(await screen.findByRole('status')).toHaveTextContent('RP-DEMO03 cancelled. The refund is on its way');
        expect(screen.queryByText('RP-DEMO03')).not.toBeInTheDocument();
    });

    it('can keep an order, skip the refund, and explains a failed refund', async () => {
        const cancel = vi.spyOn(demo, 'cancel');
        render(<OrdersBoard />);
        await screen.findByText('RP-DEMO03');
        fireEvent.click(within(card('RP-DEMO03')).getByRole('button', { name: 'Cancel order' }));
        fireEvent.click(within(card('RP-DEMO03')).getByRole('button', { name: 'Keep order' }));
        fireEvent.click(within(card('RP-DEMO03')).getByRole('button', { name: 'Cancel order' }));
        fireEvent.click(within(card('RP-DEMO03')).getByRole('checkbox', { name: /Refund/ }));
        fireEvent.change(within(card('RP-DEMO03')).getByLabelText('Reason'), { target: { value: 'Asked by guest' } });
        cancel.mockResolvedValueOnce({ order: { ...(await demo.getOrder('demo-ord-3')), status: 'CANCELLED' }, refund: 'failed' });
        fireEvent.click(within(card('RP-DEMO03')).getByRole('button', { name: 'Confirm cancel' }));
        expect(await screen.findByRole('status')).toHaveTextContent("refund didn't go through");
        expect(cancel).toHaveBeenCalledWith('demo-ord-3', 'Asked by guest', false);
    });

    it('a cash order cancels without a refund option', async () => {
        render(<OrdersBoard />);
        await screen.findByText('RP-DEMO02');
        fireEvent.click(within(card('RP-DEMO02')).getByRole('button', { name: 'Cancel order' }));
        expect(within(card('RP-DEMO02')).queryByRole('checkbox')).not.toBeInTheDocument();
        fireEvent.change(within(card('RP-DEMO02')).getByLabelText('Reason'), { target: { value: 'No show' } });
        fireEvent.click(within(card('RP-DEMO02')).getByRole('button', { name: 'Confirm cancel' }));
        expect(await screen.findByRole('status')).toHaveTextContent('RP-DEMO02 cancelled.');
    });

    it('shows all orders, empty states and errors', async () => {
        render(<OrdersBoard />);
        await screen.findByText('RP-DEMO01');
        fireEvent.change(screen.getByLabelText('Which orders'), { target: { value: 'all' } });
        expect(await screen.findByText('RP-DEMO04')).toBeInTheDocument();
        expect(within(card('RP-DEMO04')).queryByRole('button')).not.toBeInTheDocument();

        vi.spyOn(demo, 'setStatus').mockRejectedValueOnce(new Error('This order was just updated.'));
        fireEvent.click(within(card('RP-DEMO02')).getByRole('button', { name: 'Mark ready' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('This order was just updated.');

        vi.spyOn(demo, 'cancel').mockRejectedValueOnce(new Error('Cannot cancel'));
        fireEvent.click(within(card('RP-DEMO02')).getByRole('button', { name: 'Cancel order' }));
        fireEvent.change(within(card('RP-DEMO02')).getByLabelText('Reason'), { target: { value: 'x' } });
        fireEvent.click(within(card('RP-DEMO02')).getByRole('button', { name: 'Confirm cancel' }));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Cannot cancel'));
    });

    it('shows an empty board and a load error', async () => {
        vi.spyOn(demo, 'getFeed').mockResolvedValueOnce({ orders: [], serverTime: 'now' });
        const { unmount } = render(<OrdersBoard />);
        expect(await screen.findByText('No open orders right now.')).toBeInTheDocument();
        unmount();
        vi.spyOn(demo, 'getFeed').mockRejectedValueOnce(new Error('Network down'));
        render(<OrdersBoard />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
        vi.spyOn(demo, 'getFeed').mockResolvedValueOnce({ orders: [], serverTime: 'now' });
        fireEvent.change(screen.getByLabelText('Which orders'), { target: { value: 'all' } });
        expect(await screen.findByText('No orders yet.')).toBeInTheDocument();
    });

    it('polls for new orders while the open view is showing', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const feed = vi.spyOn(demo, 'getFeed');
        render(<OrdersBoard />);
        await screen.findByText('RP-DEMO01');
        const fresh = { ...(await demo.getOrder('demo-ord-1')), id: 'demo-ord-9', orderNumber: 'RP-NEW009', createdAt: new Date().toISOString() };
        feed.mockResolvedValueOnce({ orders: [fresh], serverTime: new Date().toISOString() });
        await act(async () => { await vi.advanceTimersByTimeAsync(ORDERS_POLL_MS); });
        expect(await screen.findByText('RP-NEW009')).toBeInTheDocument();
        expect(feed).toHaveBeenLastCalledWith({ status: 'all', since: expect.any(String) });
        // A failed poll leaves the board alone; an empty one changes nothing.
        feed.mockRejectedValueOnce(new Error('offline'));
        await act(async () => { await vi.advanceTimersByTimeAsync(ORDERS_POLL_MS); });
        feed.mockResolvedValueOnce({ orders: [], serverTime: new Date().toISOString() });
        await act(async () => { await vi.advanceTimersByTimeAsync(ORDERS_POLL_MS); });
        expect(screen.getByText('RP-NEW009')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('is reachable from the Website hub', async () => {
        render(<WebsiteCms initialTab="orders" />);
        expect(await screen.findByText('RP-DEMO01')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
        expect(await screen.findByText('Ordering settings')).toBeInTheDocument();
    });
});

describe('OrderingSettings', () => {
    it('loads, edits and saves', async () => {
        render(<OrderingSettings />);
        const slug = await screen.findByLabelText('Web address');
        expect(slug).toHaveValue('demo-kitchen');
        fireEvent.change(slug, { target: { value: 'demo-hyd' } });
        fireEvent.change(screen.getByLabelText('Tax (%)'), { target: { value: '12' } });
        fireEvent.click(screen.getByRole('checkbox', { name: /Dine-in/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
        expect(await screen.findByRole('status')).toHaveTextContent('Settings saved.');
        expect(_demoOrdersState()).toMatchObject({ slug: 'demo-hyd', ordering: { taxRatePercent: 12, dineIn: { enabled: true } } });
        fireEvent.click(screen.getByRole('checkbox', { name: /Taking orders/ }));
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('hides delivery fields when delivery is off and edits them when on', async () => {
        render(<OrderingSettings />);
        await screen.findByLabelText('Web address');
        fireEvent.change(screen.getByLabelText('Delivery fee (₹)'), { target: { value: '30' } });
        fireEvent.change(screen.getByLabelText('Minimum order (₹)'), { target: { value: '150' } });
        fireEvent.change(screen.getByLabelText('Free delivery above (₹)'), { target: { value: '' } });
        fireEvent.click(screen.getByRole('checkbox', { name: /Pickup/ }));
        fireEvent.click(screen.getByRole('checkbox', { name: /Accept cash/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
        await screen.findByRole('status');
        expect(_demoOrdersState().ordering).toMatchObject({ delivery: { flatFee: 30, minOrder: 150 }, pickup: { enabled: false }, cashAccepted: false });
        fireEvent.click(screen.getByRole('checkbox', { name: /Delivery/ }));
        expect(screen.queryByLabelText('Delivery fee (₹)')).not.toBeInTheDocument();
    });

    it('shows form and server errors', async () => {
        render(<OrderingSettings />);
        const slug = await screen.findByLabelText('Web address');
        fireEvent.change(slug, { target: { value: 'Bad Slug' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('lowercase letters');
        fireEvent.change(slug, { target: { value: 'fine-slug' } });
        vi.spyOn(demo, 'saveSettings').mockRejectedValueOnce(new Error('That web address is taken. Try another.'));
        fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('That web address is taken.'));
    });

    it('explains when online payment is not set up, and load failures', async () => {
        vi.spyOn(demo, 'getSettings').mockResolvedValueOnce({ slug: null, suggestedSlug: 'abc-def', onlinePaymentsAvailable: false, ordering: _demoOrdersState().ordering });
        const { unmount } = render(<OrderingSettings />);
        expect(await screen.findByText(/Online payment isn't set up yet/)).toBeInTheDocument();
        expect(screen.getByLabelText('Web address')).toHaveValue('abc-def');
        unmount();
        vi.spyOn(demo, 'getSettings').mockRejectedValueOnce(new Error('Server error'));
        render(<OrderingSettings />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Server error');
    });
});
