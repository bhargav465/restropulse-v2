/**
 * Walks the demo build end to end: landing → login → every main screen →
 * every Website tab, with the in-browser demo backend answering all API
 * calls. Fails if any screen hits an endpoint without sample data, logs an
 * error, or lands on the error boundary.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

function memoryStorage(): Storage {
    const data = new Map<string, string>();
    return {
        get length() { return data.size; },
        clear: () => data.clear(),
        getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
        key: (i: number) => Array.from(data.keys())[i] ?? null,
        removeItem: (k: string) => { data.delete(k); },
        setItem: (k: string, v: string) => { data.set(k, String(v)); },
    };
}

describe('demo build walkthrough', () => {
    const gaps: string[] = [];
    const errors: string[] = [];
    let realLocal: Storage;

    beforeAll(() => {
        vi.stubEnv('VITE_DEMO_MODE', 'true');
        vi.stubEnv('VITE_WEBSITE_CMS', 'true');
        realLocal = global.localStorage;
        Object.defineProperty(global, 'localStorage', { value: memoryStorage(), configurable: true, writable: true });
        // Every fetch the app makes must be answered by the demo backend.
        global.fetch = vi.fn(async (input: RequestInfo | URL) => {
            throw new Error(`network call escaped the demo backend: ${String(input)}`);
        }) as typeof fetch;
        vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
            const msg = args.map(String).join(' ');
            if (msg.startsWith('[demo] no sample data')) gaps.push(msg);
        });
        vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
            errors.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
        });
    });

    afterAll(() => {
        vi.unstubAllEnvs();
        Object.defineProperty(global, 'localStorage', { value: realLocal, configurable: true, writable: true });
        vi.restoreAllMocks();
    });

    it('logs in and opens every screen with sample data', async () => {
        const { installDemoBackend } = await import('../demo-backend');
        installDemoBackend();
        const { initClientConfig } = await import('../utils/client-config');
        await initClientConfig();
        const { default: App } = await import('../App');

        const { default: DemoBadge } = await import('../components/DemoBadge');
        render(<><App /><DemoBadge /></>);

        // Landing → Login
        fireEvent.click((await screen.findAllByRole('button', { name: 'Log in' }))[0]);
        expect(await screen.findByText(/Demo preview: enter any 10-digit number/)).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '9876543210' } });
        fireEvent.click(screen.getByRole('button', { name: /Get OTP/ }));

        // Signed in: the shell shows the sample restaurant.
        await waitFor(() => expect(screen.getAllByText('[SAMPLE] RestroPulse Demo Kitchen').length).toBeGreaterThan(0), { timeout: 5000 });

        const nav = () => within(screen.getAllByRole('navigation', { name: 'Sidebar' })[0]);

        for (const label of ['Content Studio', 'Updates', 'Content Strategy', 'Intelligence', 'Website']) {
            fireEvent.click(nav().getByText(label));
            await waitFor(() => expect(screen.queryByText(/Loading/)).not.toBeInTheDocument(), { timeout: 5000 }).catch(() => undefined);
            await new Promise((r) => setTimeout(r, 400));
            expect(screen.queryByText(/Something went wrong/i), `${label} crashed`).not.toBeInTheDocument();
        }

        // Content Studio: approve a post, then create one.
        fireEvent.click(nav().getByText('Content Studio'));
        const approve = (await screen.findAllByRole('button', { name: /^Approve$/ }, { timeout: 5000 }))[0];
        fireEvent.click(approve);
        await waitFor(() => expect(screen.getAllByRole('button', { name: /^Approve$/ }).length).toBeLessThan(2), { timeout: 5000 });

        fireEvent.click(screen.getAllByRole('button', { name: 'Create post' })[0]);
        fireEvent.change(await screen.findByTestId('concept-input'), { target: { value: 'Sunday brunch' } });
        fireEvent.click(screen.getByTestId('submit-button'));
        expect(await screen.findByText(/A caption written for "Sunday brunch"/, {}, { timeout: 5000 })).toBeInTheDocument();

        // Strategy: approve the pending cycle.
        fireEvent.click(nav().getByText('Content Strategy'));
        fireEvent.click(await screen.findByRole('button', { name: 'Approve strategy' }, { timeout: 5000 }));
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve strategy' })).not.toBeInTheDocument(), { timeout: 5000 });

        // Every Website tab
        fireEvent.click(nav().getByText('Website'));
        const tablist = await screen.findByRole('tablist', { name: 'Website sections' });
        for (const tab of within(tablist).getAllByRole('tab')) {
            fireEvent.click(tab);
            await new Promise((r) => setTimeout(r, 500));
            expect(screen.queryByText(/Something went wrong/i), `${tab.textContent} tab crashed`).not.toBeInTheDocument();
            expect(screen.queryByText(/Failed to fetch|HTTP 404|escaped the demo backend/i), `${tab.textContent} tab failed to load`).not.toBeInTheDocument();
        }

        // Orders: book a rider on the new delivery order and move it along.
        fireEvent.click(within(tablist).getByRole('tab', { name: 'Orders' }));
        fireEvent.click((await screen.findAllByRole('button', { name: 'Find a rider' }, { timeout: 5000 }))[0]);
        expect(await screen.findByText('Rider requested', {}, { timeout: 5000 })).toBeInTheDocument();
        fireEvent.click(screen.getAllByRole('button', { name: 'Start preparing' })[0]);
        await waitFor(() => expect(screen.getAllByText(/Preparing/).length).toBeGreaterThan(0));

        // The demo label shows on every screen.
        expect(screen.getByRole('note', { name: 'Demo preview' })).toBeInTheDocument();

        // Account sheet (plans, invoices, Instagram) opens, and logging out returns to the landing page.
        fireEvent.click(screen.getAllByRole('button', { name: 'Account' })[0]);
        fireEvent.click(await screen.findByRole('button', { name: /Log ?out/i }, { timeout: 5000 }));
        expect((await screen.findAllByRole('button', { name: 'Log in' }, { timeout: 5000 })).length).toBeGreaterThan(0);

        expect(gaps, 'endpoints without sample data').toEqual([]);
        expect(errors.filter((e) => !/act\(|not wrapped in act/.test(e)), 'console errors').toEqual([]);
    }, 30000);
});
