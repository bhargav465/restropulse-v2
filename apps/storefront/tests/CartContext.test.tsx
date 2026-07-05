import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CartProvider, useCart } from '../store/CartContext';

// CartProvider reads restaurant settings + slug from StorefrontContext and
// fires analytics — mock both so the provider can run in isolation.
vi.mock('../store/StorefrontContext', () => ({
    useStorefront: () => ({
        slug: 'demo',
        ordering: {
            taxRatePercent: 5,
            currency: 'INR',
            delivery: { enabled: true, flatFee: 30, minOrder: 200 },
            pickup: { enabled: true },
        },
        currency: 'INR',
    }),
}));

vi.mock('../lib/analytics', () => ({
    track: vi.fn(),
    getSessionId: () => 'test-session',
}));

const Harness: React.FC = () => {
    const { lines, count, totals, addItem, setQty, remove, orderType, setOrderType } = useCart();
    return (
        <div>
            <p data-testid="count">{count}</p>
            <p data-testid="total">{totals.total}</p>
            <p data-testid="delivery-fee">{totals.deliveryFee}</p>
            <p data-testid="order-type">{orderType}</p>
            <button onClick={() => addItem({ menuItemId: 'm1', name: 'Dosa', isVeg: true, basePrice: 100, qty: 2 })}>
                add dosa
            </button>
            <button onClick={() => addItem({ menuItemId: 'm2', name: 'Chai', isVeg: true, basePrice: 20, addons: [{ id: 'a1', name: 'Ginger', price: 5 }] })}>
                add chai
            </button>
            <button onClick={() => setOrderType('pickup')}>pickup</button>
            {lines.map((l) => (
                <div key={l.key}>
                    <span>{l.name} x{l.qty}</span>
                    <button onClick={() => setQty(l.key, l.qty + 1)}>inc {l.name}</button>
                    <button onClick={() => remove(l.key)}>remove {l.name}</button>
                </div>
            ))}
        </div>
    );
};

const renderCart = () =>
    render(
        <CartProvider>
            <Harness />
        </CartProvider>,
    );

describe('CartContext', () => {
    it('starts empty with zero totals', () => {
        renderCart();
        expect(screen.getByTestId('count')).toHaveTextContent('0');
        expect(screen.getByTestId('total')).toHaveTextContent('0');
    });

    it('adds items and computes totals from restaurant config (tax + delivery fee)', () => {
        renderCart();
        fireEvent.click(screen.getByText('add dosa')); // 2 x 100 = 200
        expect(screen.getByTestId('count')).toHaveTextContent('2');
        // subtotal 200 + tax 10 (5%) + delivery 30
        expect(screen.getByTestId('total')).toHaveTextContent('240');
    });

    it('merges repeated adds of the same item and supports qty updates', () => {
        renderCart();
        fireEvent.click(screen.getByText('add dosa'));
        fireEvent.click(screen.getByText('add dosa'));
        expect(screen.getByText('Dosa x4')).toBeInTheDocument();
        fireEvent.click(screen.getByText('inc Dosa'));
        expect(screen.getByText('Dosa x5')).toBeInTheDocument();
    });

    it('removes lines', () => {
        renderCart();
        fireEvent.click(screen.getByText('add dosa'));
        fireEvent.click(screen.getByText('add chai'));
        fireEvent.click(screen.getByText('remove Chai'));
        expect(screen.queryByText(/Chai x/)).not.toBeInTheDocument();
        expect(screen.getByText('Dosa x2')).toBeInTheDocument();
    });

    it('drops the delivery fee when switching to pickup', () => {
        renderCart();
        fireEvent.click(screen.getByText('add dosa'));
        expect(screen.getByTestId('delivery-fee')).toHaveTextContent('30');
        fireEvent.click(screen.getByText('pickup'));
        expect(screen.getByTestId('order-type')).toHaveTextContent('pickup');
        expect(screen.getByTestId('delivery-fee')).toHaveTextContent('0');
        // subtotal 200 + tax 10
        expect(screen.getByTestId('total')).toHaveTextContent('210');
    });

    it('persists the cart to localStorage under the slug key', () => {
        renderCart();
        fireEvent.click(screen.getByText('add dosa'));
        const stored = JSON.parse(localStorage.getItem('sf_cart_demo') ?? '[]');
        expect(stored).toHaveLength(1);
        expect(stored[0].menuItemId).toBe('m1');
        expect(stored[0].qty).toBe(2);
    });

    it('hydrates the cart from localStorage on mount', () => {
        localStorage.setItem(
            'sf_cart_demo',
            JSON.stringify([{ key: 'm9||', menuItemId: 'm9', name: 'Idli', isVeg: true, unitPrice: 60, qty: 3, addons: [] }]),
        );
        renderCart();
        expect(screen.getByTestId('count')).toHaveTextContent('3');
        expect(screen.getByText('Idli x3')).toBeInTheDocument();
    });
});
