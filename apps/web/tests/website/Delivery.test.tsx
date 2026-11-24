import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '../utils/test-utils';
import DeliverySettings, { withOwnRidersLast } from '../../components/website/DeliverySettings';
import OrderRider, { nextOwnRiderStep, riderTone } from '../../components/website/OrderRider';
import OrdersBoard from '../../components/website/OrdersBoard';
import { deliveryAPI as demo, resetDemoDelivery, _demoDeliveryState } from '../../demo-api-delivery';
import { ordersAPI as demoOrders, resetDemoOrders } from '../../demo-api-orders';
import type { AdminOrder, OrderRiderView } from '../../api';

const api = vi.hoisted(() => ({ override: null as null | Partial<Record<string, unknown>> }));

vi.mock('../../api', async () => {
    const demoDelivery = (await import('../../demo-api-delivery')).deliveryAPI;
    return {
        ordersAPI: (await import('../../demo-api-orders')).ordersAPI,
        deliveryAPI: new Proxy(demoDelivery, { get: (t, k: string) => (api.override?.[k] ?? (t as Record<string, unknown>)[k]) }),
    };
});

beforeEach(() => {
    resetDemoOrders();
    resetDemoDelivery();
    api.override = null;
    vi.restoreAllMocks();
});

describe('helpers', () => {
    it('keeps own riders last and picks tones and next steps', () => {
        expect(withOwnRidersLast(['self', 'mock'])).toEqual(['mock', 'self']);
        expect(withOwnRidersLast([])).toEqual(['self']);
        expect(riderTone('DELIVERED')).toBe('success');
        expect(riderTone('FAILED')).toBe('danger');
        expect(riderTone('IN_TRANSIT')).toBe('warning');
        expect(riderTone('BOOKED')).toBe('primary');
        expect(nextOwnRiderStep('BOOKED')?.status).toBe('RIDER_ASSIGNED');
        expect(nextOwnRiderStep('RIDER_ASSIGNED')?.status).toBe('PICKED_UP');
        expect(nextOwnRiderStep('IN_TRANSIT')?.status).toBe('DELIVERED');
        expect(nextOwnRiderStep('DELIVERED')).toBeUndefined();
    });
});

describe('demo twin', () => {
    it('books the test partner, moves it on each read and moves the order', async () => {
        await expect(demo.getRider('demo-ord-2')).rejects.toThrow('Only delivery orders');
        expect(await demo.getRider('demo-ord-1')).toEqual({ shipment: null, queued: null, lastError: null });
        expect((await demo.findRider('demo-ord-1')).shipment).toMatchObject({ provider: 'mock', status: 'BOOKED', fee: 45 });
        await expect(demo.findRider('demo-ord-1')).rejects.toThrow('already booked');
        await expect(demo.updateOwnRider('demo-ord-1', { status: 'PICKED_UP' })).rejects.toThrow('own rider');
        expect((await demo.getRider('demo-ord-1')).shipment).toMatchObject({ status: 'RIDER_ASSIGNED', rider: { name: '[SAMPLE] Test Rider' } });
        const picked = await demo.getRider('demo-ord-1');
        expect(picked.orderStatus).toBe('OUT_FOR_DELIVERY');
        await expect(demo.cancelRider('demo-ord-1', 'x')).rejects.toThrow('already has the food');
        await demo.getRider('demo-ord-1');
        expect((await demo.getRider('demo-ord-1')).orderStatus).toBe('COMPLETED');
        expect((await demo.getRider('demo-ord-1')).orderStatus).toBeUndefined();
        await expect(demo.cancelRider('demo-ord-1', 'x')).rejects.toThrow('no rider booking');
        await expect(demo.useOwnRider('demo-ord-1')).rejects.toThrow('past the point');
    });

    it('runs own riders and cancels before pickup', async () => {
        await demo.saveSettings({ dispatchEnabled: true, dispatchAt: 'READY', strategy: 'preferred', providers: ['self'] });
        expect((await demo.findRider('demo-ord-1')).shipment?.provider).toBe('self');
        const assigned = await demo.updateOwnRider('demo-ord-1', { status: 'RIDER_ASSIGNED', riderName: 'Ravi', riderPhone: '+91 98' });
        expect(assigned.shipment?.rider).toEqual({ name: 'Ravi', phone: '+91 98' });
        await expect(demo.updateOwnRider('demo-ord-1', { status: 'RIDER_ASSIGNED' })).rejects.toThrow('already done');
        expect((await demo.cancelRider('demo-ord-1', 'Customer will collect')).shipment).toMatchObject({ status: 'CANCELLED', cancelReason: 'Customer will collect' });
        expect((await demo.useOwnRider('demo-ord-1')).shipment?.status).toBe('BOOKED');
        expect((await demo.updateOwnRider('demo-ord-1', { status: 'DELIVERED' })).orderStatus).toBe('COMPLETED');
        expect(_demoDeliveryState().shipments).toHaveLength(2);
        await expect(demo.saveSettings({ dispatchEnabled: true, dispatchAt: 'READY', strategy: 'preferred', providers: ['rapido'] })).rejects.toThrow("rapido isn't available");
        expect((await demo.getSettings()).providers.map((p) => p.id)).toEqual(['self', 'mock']);
    });
});

describe('DeliverySettings', () => {
    it('loads, edits and saves', async () => {
        const save = vi.spyOn(demo, 'saveSettings');
        render(<DeliverySettings />);
        const auto = await screen.findByLabelText(/Book a rider automatically/);
        expect(auto).toBeChecked();
        fireEvent.click(auto);
        fireEvent.change(screen.getByLabelText('Book when the order is'), { target: { value: 'PREPARING' } });
        fireEvent.click(screen.getByLabelText('Test partner (mock)'));
        expect(screen.queryByLabelText('Choose a partner')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Save rider settings' }));
        expect(await screen.findByText('Rider settings saved.')).toBeInTheDocument();
        expect(save).toHaveBeenCalledWith({ dispatchEnabled: false, dispatchAt: 'PREPARING', strategy: 'preferred', providers: ['self'] });
        fireEvent.click(screen.getByLabelText('Test partner (mock)'));
        expect(screen.queryByText('Rider settings saved.')).not.toBeInTheDocument();
    });

    it('offers a strategy with several partners and explains having none', async () => {
        const two = { settings: { dispatchEnabled: true, dispatchAt: 'READY', strategy: 'preferred', providers: ['mock', 'self'] }, providers: [
            { id: 'self', label: 'Your own riders', kind: 'own', webhooks: false },
            { id: 'mock', label: 'Test partner (mock)', kind: 'partner', webhooks: false },
            { id: 'rapido', label: 'Rapido', kind: 'partner', webhooks: true },
        ] };
        api.override = { getSettings: vi.fn(async () => two), saveSettings: vi.fn(async () => { throw new Error('Server says no'); }) };
        render(<DeliverySettings />);
        fireEvent.change(await screen.findByLabelText('Choose a partner'), { target: { value: 'cheapest' } });
        fireEvent.click(screen.getByLabelText('Rapido'));
        fireEvent.click(screen.getByRole('button', { name: 'Save rider settings' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Server says no');
        expect(api.override.saveSettings).toHaveBeenCalledWith({ dispatchEnabled: true, dispatchAt: 'READY', strategy: 'cheapest', providers: ['mock', 'rapido', 'self'] });
    });

    it('says when no partner is connected, and when loading fails', async () => {
        api.override = { getSettings: vi.fn(async () => ({ settings: { dispatchEnabled: false, dispatchAt: 'READY', strategy: 'preferred', providers: ['self'] }, providers: [{ id: 'self', label: 'Your own riders', kind: 'own', webhooks: false }] })) };
        const { unmount } = render(<DeliverySettings />);
        expect(await screen.findByText(/own riders take every order/)).toBeInTheDocument();
        unmount();
        api.override = { getSettings: vi.fn(async () => { throw new Error('Offline'); }) };
        render(<DeliverySettings />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
    });
});

describe('OrderRider', () => {
    const order = async (id = 'demo-ord-1') => (await demoOrders.getOrder(id)) as AdminOrder;

    it('finds a partner rider and shows who is coming', async () => {
        const changed = vi.fn();
        const o = await order();
        render(<OrderRider order={o} onOrderChanged={changed} />);
        expect(await screen.findByText('None booked yet')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Find a rider' }));
        expect(await screen.findByText('Rider requested')).toBeInTheDocument();
        expect(screen.getByText(/Mock Rider Co/)).toHaveTextContent('Mock Rider Co · about 30 min · ₹45');
        fireEvent.click(screen.getByRole('button', { name: 'Cancel rider' }));
        const confirm = screen.getByRole('button', { name: 'Confirm' });
        expect(confirm).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Keep rider' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel rider' }));
        fireEvent.change(screen.getByLabelText('Why cancel the rider'), { target: { value: 'Customer will collect' } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
        expect(await screen.findByText('Rider cancelled')).toBeInTheDocument();
        expect(screen.getByText('Customer will collect')).toBeInTheDocument();
        expect(changed).not.toHaveBeenCalled();
    });

    it('walks an own rider through to delivery and tells the board', async () => {
        const changed = vi.fn();
        render(<OrderRider order={await order()} onOrderChanged={changed} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Use own rider' }));
        fireEvent.change(await screen.findByLabelText("Rider's name"), { target: { value: 'Ravi' } });
        fireEvent.click(screen.getByRole('button', { name: 'Rider assigned' }));
        expect(await screen.findByText(/Own rider · Ravi/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Picked up' }));
        await waitFor(() => expect(changed).toHaveBeenCalledWith('demo-ord-1'));
        fireEvent.click(await screen.findByRole('button', { name: 'Delivered' }));
        expect(await screen.findByText('Delivered')).toBeInTheDocument();
    });

    it('shows queued jobs, failed dispatches and action errors', async () => {
        const o = await order();
        const views: OrderRiderView[] = [
            { shipment: null, queued: 'dispatch', lastError: null },
        ];
        api.override = { getRider: vi.fn(async () => views[0]) };
        const { unmount } = render(<OrderRider order={o} onOrderChanged={vi.fn()} />);
        expect(await screen.findByText('Finding a rider…')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Find a rider' })).not.toBeInTheDocument();
        unmount();

        api.override = {
            getRider: vi.fn(async () => ({ shipment: { id: 's', restaurantId: 'r', orderId: o.id, provider: 'mock', providerShipmentId: 'm', status: 'RIDER_ASSIGNED', events: [], createdAt: '', updatedAt: '' }, queued: 'cancel', lastError: null })),
        };
        const second = render(<OrderRider order={o} onOrderChanged={vi.fn()} />);
        expect(await screen.findByText('Cancelling…')).toBeInTheDocument();
        expect(screen.getByText('mock')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Cancel rider' })).not.toBeInTheDocument();
        second.unmount();

        api.override = {
            getRider: vi.fn(async () => ({ shipment: null, queued: null, lastError: 'No address' })),
            findRider: vi.fn(async () => { throw new Error('A rider is already booked. Cancel it first.'); }),
        };
        render(<OrderRider order={o} onOrderChanged={vi.fn()} />);
        expect(await screen.findByText("Couldn't book a rider: No address")).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Find a rider' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('already booked');
    });

    it('skips loading for closed orders and survives a failed load', async () => {
        const get = vi.fn(async () => { throw new Error('nope'); });
        api.override = { getRider: get };
        const closed = { ...(await order()), status: 'COMPLETED' as const, delivery: { status: 'DELIVERED' as const, provider: 'mock' as const } };
        const { unmount } = render(<OrderRider order={closed} onOrderChanged={vi.fn()} />);
        expect(screen.getByText('Delivered')).toBeInTheDocument();
        expect(get).not.toHaveBeenCalled();
        unmount();
        render(<OrderRider order={await order()} onOrderChanged={vi.fn()} />);
        expect(await screen.findByText(/Couldn't load the rider just now/)).toBeInTheDocument();
    });

    it('lives on delivery cards of the order board, which refreshes the order after a rider update', async () => {
        await demo.saveSettings({ dispatchEnabled: true, dispatchAt: 'READY', strategy: 'preferred', providers: ['self'] });
        await demo.useOwnRider('demo-ord-1');
        await demo.updateOwnRider('demo-ord-1', { status: 'RIDER_ASSIGNED' });
        render(<OrdersBoard />);
        expect(await screen.findByLabelText('Rider for RP-DEMO01')).toBeInTheDocument();
        expect(screen.queryByLabelText('Rider for RP-DEMO02')).not.toBeInTheDocument();
        fireEvent.click(await screen.findByRole('button', { name: 'Picked up' }));
        // The demo moves the order one step at a time, then the board reloads the card.
        fireEvent.click(await screen.findByRole('button', { name: 'Delivered' }, { timeout: 5000 }));
        await waitFor(() => expect(screen.queryByLabelText('Rider for RP-DEMO01')).not.toBeInTheDocument(), { timeout: 5000 });
        expect((await demoOrders.getOrder('demo-ord-1')).status).toBe('COMPLETED');
    });
});
