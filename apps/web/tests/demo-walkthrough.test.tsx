/**
 * Walks the demo build end to end as each sample restaurant: landing → login
 * → every main screen → every Website tab → a few real actions → log out,
 * with the in-browser demo backend answering all API calls. Fails if any
 * screen hits an endpoint without sample data, logs an error, crashes, or
 * shows another restaurant's data.
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

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

    it('signs in as each sample restaurant and opens every screen with its own data', async () => {
        const { installDemoBackend } = await import('../demo-backend');
        installDemoBackend();
        const { initClientConfig } = await import('../utils/client-config');
        await initClientConfig();
        const { DEMO_RESTAURANTS } = await import('../lib/demo-restaurants');
        const { default: App } = await import('../App');
        const { default: DemoBadge } = await import('../components/DemoBadge');

        render(<><App /><DemoBadge /></>);
        const nav = () => within(screen.getAllByRole('navigation', { name: 'Sidebar' })[0]);
        const openTab = async (name: string) => {
            fireEvent.click(within(await screen.findByRole('tablist', { name: 'Website sections' })).getByRole('tab', { name }));
            await pause(400);
            expect(screen.queryByText(/Something went wrong/i), `${name} tab crashed`).not.toBeInTheDocument();
        };

        for (const r of DEMO_RESTAURANTS) {
            const short = r.name.replace('[SAMPLE] ', '');

            // Landing → Login → pick the sample restaurant
            fireEvent.click((await screen.findAllByRole('button', { name: 'Log in' }, { timeout: 5000 }))[0]);
            fireEvent.click(await screen.findByRole('button', { name: `Use ${short}` }));
            fireEvent.click(screen.getByRole('button', { name: /Get OTP/ }));
            await waitFor(() => expect(screen.getAllByText(r.name).length, `${short}: signed in`).toBeGreaterThan(0), { timeout: 5000 });

            for (const label of ['Content Studio', 'Updates', 'Content Strategy', 'Intelligence', 'Website']) {
                fireEvent.click(nav().getByText(label));
                await pause(400);
                expect(screen.queryByText(/Something went wrong/i), `${short}: ${label} crashed`).not.toBeInTheDocument();
            }

            // Its own menu, and none of the first sample's.
            await openTab('Menu');
            if (r.id === 'demo-r1') {
                expect(await screen.findByText('Hyderabadi Dum Biryani')).toBeInTheDocument();
            } else {
                expect(await screen.findByText(r.menu[0].items[0].name)).toBeInTheDocument();
                expect(screen.queryByText('Hyderabadi Dum Biryani')).not.toBeInTheDocument();
            }
            for (const tab of ['Offers', 'Site content', 'Website', 'Settings']) await openTab(tab);

            await openTab('Orders');
            if (r.id === 'demo-r2') {
                // Delivery order: book the test rider partner.
                expect(await screen.findByText('CCH-01')).toBeInTheDocument();
                fireEvent.click((await screen.findAllByRole('button', { name: 'Find a rider' }))[0]);
                expect(await screen.findByText('Rider requested', {}, { timeout: 5000 })).toBeInTheDocument();
            }
            if (r.id === 'demo-r3') {
                expect(await screen.findByText('BCC-01')).toBeInTheDocument();
                expect(screen.queryByRole('button', { name: 'Find a rider' })).not.toBeInTheDocument();
            }
            if (r.id === 'demo-r4') {
                expect(await screen.findByText(/No open orders right now|No orders yet/)).toBeInTheDocument();
                // New restaurant: no website yet, then set it up.
                await openTab('Website');
                expect(await screen.findByText(/Choose a web address in Settings first/)).toBeInTheDocument();
                await openTab('Settings');
                fireEvent.click(await screen.findByLabelText(/Taking orders/));
                fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
                expect(await screen.findByText('Settings saved.', {}, { timeout: 5000 })).toBeInTheDocument();
                await openTab('Website');
                expect(await screen.findByText('https://delhi-tandoor-room.restropulse.in')).toBeInTheDocument();
            }
            if (r.id === 'demo-r1') {
                // Content Studio: approve a post, then create one; approve the next strategy.
                fireEvent.click(nav().getByText('Content Studio'));
                fireEvent.click((await screen.findAllByRole('button', { name: /^Approve$/ }, { timeout: 5000 }))[0]);
                await waitFor(() => expect(screen.getAllByRole('button', { name: /^Approve$/ }).length).toBeLessThan(2), { timeout: 5000 });
                fireEvent.click(screen.getAllByRole('button', { name: 'Create post' })[0]);
                fireEvent.change(await screen.findByTestId('concept-input'), { target: { value: 'Sunday brunch' } });
                fireEvent.click(screen.getByTestId('submit-button'));
                expect(await screen.findByText(/A caption written for "Sunday brunch"/, {}, { timeout: 5000 })).toBeInTheDocument();
                fireEvent.click(nav().getByText('Content Strategy'));
                fireEvent.click(await screen.findByRole('button', { name: 'Approve strategy' }, { timeout: 5000 }));
                await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve strategy' })).not.toBeInTheDocument(), { timeout: 5000 });
            }

            // The demo label and restaurant switcher show once signed in.
            const badge = screen.getByRole('note', { name: 'Demo preview' });
            await waitFor(() => expect(within(badge).getByLabelText('Switch sample restaurant')).toHaveValue(r.id), { timeout: 3000 });

            // Account sheet opens; log out back to the landing page.
            fireEvent.click(screen.getAllByRole('button', { name: 'Account' })[0]);
            fireEvent.click(await screen.findByRole('button', { name: /Log ?out/i }, { timeout: 5000 }));
            await screen.findAllByRole('button', { name: 'Log in' }, { timeout: 5000 });
        }

        expect(gaps, 'endpoints without sample data').toEqual([]);
        expect(errors.filter((e) => !/act\(|not wrapped in act/.test(e)), 'console errors').toEqual([]);
    }, 90000);
});
