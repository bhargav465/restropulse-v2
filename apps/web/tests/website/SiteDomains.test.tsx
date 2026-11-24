import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '../utils/test-utils';
import WebsiteCms from '../../components/website/WebsiteCms';
import SiteDomains, { sslNote } from '../../components/website/SiteDomains';
import { sitesAPI as demo, resetDemoSites, _demoSitesState } from '../../demo-api-sites';
import type { SiteDomain, SiteView } from '../../api';

const api = vi.hoisted(() => ({ override: null as null | Partial<Record<string, unknown>> }));

vi.mock('../../api', async () => {
    const demoSites = (await import('../../demo-api-sites')).sitesAPI;
    return {
        cmsAPI: (await import('../../demo-api-cms')).cmsAPI,
        ordersAPI: (await import('../../demo-api-orders')).ordersAPI,
        deliveryAPI: (await import('../../demo-api-delivery')).deliveryAPI,
        sitesAPI: new Proxy(demoSites, { get: (t, k: string) => (api.override?.[k] ?? (t as Record<string, unknown>)[k]) }),
    };
});

beforeEach(() => {
    resetDemoSites();
    api.override = null;
    vi.restoreAllMocks();
});

const domainBase: SiteDomain = { id: 'd', hostname: 'a.in', status: 'active', sslStatus: 'manual', records: [] };

describe('sslNote', () => {
    it('explains TLS only for connected domains', () => {
        expect(sslNote({ ...domainBase, status: 'pending_dns' })).toBeNull();
        expect(sslNote({ ...domainBase, sslStatus: 'active' })).toMatch(/Secure/);
        expect(sslNote({ ...domainBase, sslStatus: 'failed' })).toMatch(/still setting up/);
        expect(sslNote(domainBase)).toMatch(/RestroPulse team/);
    });
});

describe('demo twin', () => {
    it('adds, checks twice and removes', async () => {
        await expect(demo.addDomain('localhost')).rejects.toThrow(/domain you own/);
        const d = await demo.addDomain('https://WWW.Sample.in/');
        expect(d.hostname).toBe('www.sample.in');
        await expect(demo.addDomain('www.sample.in')).rejects.toThrow(/already connected/);
        expect((await demo.verifyDomain(d.id)).status).toBe('failed');
        expect((await demo.verifyDomain(d.id)).status).toBe('active');
        expect((await demo.verifyDomain(d.id)).status).toBe('active');
        await demo.addDomain('two.in');
        await demo.addDomain('three.in');
        await expect(demo.addDomain('four.in')).rejects.toThrow(/up to 3/);
        await demo.removeDomain(d.id);
        await expect(demo.removeDomain(d.id)).rejects.toThrow(/not found/);
        expect(_demoSitesState().domains).toHaveLength(2);
    });
});

describe('SiteDomains screen', () => {
    it('shows the site address and connects a domain end to end', async () => {
        render(<SiteDomains />);
        expect(await screen.findByText('https://demo-kitchen.restropulse.in')).toBeInTheDocument();
        expect(screen.getByText('https://sites.restropulse.in/r/demo-kitchen')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText(/Already own a domain/), { target: { value: 'www.sample-kitchen.in' } });
        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
        expect(await screen.findByRole('heading', { name: 'www.sample-kitchen.in' })).toBeInTheDocument();
        expect(screen.getByText('Add DNS records')).toBeInTheDocument();
        expect(screen.getByText('_restropulse.www.sample-kitchen.in')).toBeInTheDocument();
        expect(screen.getByText('sites.restropulse.in')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Check DNS' }));
        expect(await screen.findByText('Not found yet')).toBeInTheDocument();
        expect(screen.getByText(/No TXT record found/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Check DNS' }));
        expect(await screen.findByText('Connected')).toBeInTheDocument();
        expect(screen.getByText(/RestroPulse team/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Check DNS' })).not.toBeInTheDocument();
    });

    it('copies a record value', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });
        await demo.addDomain('copy.in');
        render(<SiteDomains />);
        fireEvent.click(await screen.findByRole('button', { name: 'Copy name copy.in' }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith('copy.in'));
        expect(await screen.findByText('Copied')).toBeInTheDocument();
    });

    it('a blocked clipboard does nothing', async () => {
        Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('no')) } });
        await demo.addDomain('copy.in');
        render(<SiteDomains />);
        fireEvent.click(await screen.findByRole('button', { name: 'Copy name copy.in' }));
        await waitFor(() => expect(screen.queryByText('Copied')).not.toBeInTheDocument());
    });

    it('shows add errors and removes after confirming', async () => {
        render(<SiteDomains />);
        await screen.findByText('https://demo-kitchen.restropulse.in');
        fireEvent.change(screen.getByLabelText(/Already own a domain/), { target: { value: 'localhost' } });
        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(/domain you own/);

        fireEvent.change(screen.getByLabelText(/Already own a domain/), { target: { value: 'keep.in' } });
        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
        await screen.findByRole('heading', { name: 'keep.in' });

        const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
        fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
        expect(screen.getByRole('heading', { name: 'keep.in' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
        await waitFor(() => expect(screen.queryByRole('heading', { name: 'keep.in' })).not.toBeInTheDocument());
        expect(confirm).toHaveBeenCalledTimes(2);
    });

    it('stops adding at the limit', async () => {
        for (const h of ['a-one.in', 'a-two.in', 'a-three.in']) await demo.addDomain(h);
        render(<SiteDomains />);
        expect(await screen.findByText(/up to 3 domains/)).toBeInTheDocument();
        expect(screen.getByLabelText(/Already own a domain/)).toBeDisabled();
    });

    const viewWith = (over: Partial<SiteView>): SiteView => ({
        slug: 'x-kitchen', previewUrl: null, subdomainUrl: null, cnameTarget: null, domainsAvailable: false, maxDomains: 3, domains: [], ...over,
    });

    it('explains when nothing is live yet', async () => {
        api.override = { getSite: vi.fn().mockResolvedValue(viewWith({})) };
        render(<SiteDomains />);
        expect(await screen.findByText(/isn't live yet/)).toBeInTheDocument();
        expect(screen.getByText(/Own domains aren't available yet/)).toBeInTheDocument();
    });

    it('asks for a web address first, and shows only the preview when there is no subdomain', async () => {
        api.override = { getSite: vi.fn().mockResolvedValue(viewWith({ slug: null })) };
        const { unmount } = render(<SiteDomains />);
        expect(await screen.findByText(/Choose a web address in Settings first/)).toBeInTheDocument();
        unmount();
        api.override = { getSite: vi.fn().mockResolvedValue(viewWith({ previewUrl: 'https://s.in/r/x-kitchen' })) };
        render(<SiteDomains />);
        expect(await screen.findByText('https://s.in/r/x-kitchen')).toBeInTheDocument();
        expect(screen.queryByText(/Preview link/)).not.toBeInTheDocument();
    });

    it('shows a load error', async () => {
        api.override = { getSite: vi.fn().mockRejectedValue(new Error('Network down')) };
        render(<SiteDomains />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
    });

    it('is a tab in the Website hub', async () => {
        render(<WebsiteCms initialTab="site" />);
        expect(await screen.findByText('Your website')).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Website' })).toHaveAttribute('aria-selected', 'true');
    });
});
