import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '../utils/test-utils';
import WebsiteCms from '../../components/website/WebsiteCms';
import { parseOptionLines } from '../../components/website/MenuEditor';
import { draftToInput } from '../../components/website/OffersEditor';
import { cleanContent, hoursFromRows } from '../../components/website/SiteContentEditor';
import { resetDemoCms, cmsAPI as demo } from '../../demo-api-cms';

// Drive the screens through the in-memory demo twin so they exercise real
// state changes without a backend.
vi.mock('../../api', async () => ({
    cmsAPI: (await import('../../demo-api-cms')).cmsAPI,
    ordersAPI: (await import('../../demo-api-orders')).ordersAPI,
    sitesAPI: (await import('../../demo-api-sites')).sitesAPI,
    deliveryAPI: (await import('../../demo-api-delivery')).deliveryAPI,
}));

beforeEach(() => {
    resetDemoCms();
    vi.restoreAllMocks();
});

describe('helpers', () => {
    it('parses option lines', () => {
        expect(parseOptionLines('Half: 260\n\n Full : 420 ')).toEqual([{ name: 'Half', price: 260 }, { name: 'Full', price: 420 }]);
        expect(parseOptionLines('Half 260')).toMatch(/Name: price/);
    });

    it('validates and builds an offer body', () => {
        const base = {
            title: 'Lunch', description: '', rewardKind: 'percent_off' as const, percent: '15', maxDiscount: '150', amount: '', minOrderValue: '500',
            code: 'LUNCH', startsOn: '2026-11-01', endsOn: '', days: ['mon' as const], from: '12:00', to: '15:00',
            showOnSite: true, promoteInContent: false, status: 'active' as const,
        };
        expect(draftToInput(base)).toEqual({
            title: 'Lunch', description: null, reward: { kind: 'percent_off', percent: 15, maxDiscount: 150 }, minOrderValue: 500, code: 'LUNCH',
            schedule: { startsAt: '2026-11-01', endsAt: null, days: ['mon'], from: '12:00', to: '15:00' },
            showOnSite: true, promoteInContent: false, status: 'active',
        });
        expect(draftToInput({ ...base, title: ' ' })).toBe('Give the offer a name.');
        expect(draftToInput({ ...base, percent: '120' })).toMatch(/between 1 and 100/);
        expect(draftToInput({ ...base, rewardKind: 'flat_off', amount: '0' })).toMatch(/amount off/);
        expect(draftToInput({ ...base, rewardKind: 'flat_off', amount: '50' })).toMatchObject({ reward: { kind: 'flat_off', amount: 50 } });
        expect(draftToInput({ ...base, rewardKind: 'free_delivery', from: '', to: '', minOrderValue: '', code: '' }))
            .toMatchObject({ reward: { kind: 'free_delivery' }, minOrderValue: null, code: null, schedule: { from: null, to: null } });
        expect(draftToInput({ ...base, to: '' })).toMatch(/both a start and an end time/);
        expect(draftToInput({ ...base, startsOn: '' })).toBe('Pick a start date.');
    });

    it('cleans blank content and keeps filled hours', () => {
        expect(cleanContent({ heroImages: [], tagline: ' ', contact: { phone: '' }, announcement: { text: '', enabled: true }, about: 'Hi' }))
            .toEqual({ heroImages: [], about: 'Hi' });
        expect(cleanContent({ heroImages: undefined as unknown as string[] })).toEqual({ heroImages: [] });
        expect(hoursFromRows([
            { day: 'Monday', open: '11:00', close: '23:00' },
            { day: 'Tuesday', open: '11:00', close: '' },
            { day: 'Wednesday', open: '', close: '', closed: true },
        ])).toEqual([{ day: 'Monday', open: '11:00', close: '23:00' }, { day: 'Wednesday', open: '00:00', close: '00:00', closed: true }]);
        expect(hoursFromRows([{ day: 'Monday', open: '', close: '' }])).toBeUndefined();
    });
});

describe('Menu tab', () => {
    it('lists categories and items, and toggles availability', async () => {
        render(<WebsiteCms />);
        expect(await screen.findByText('Paneer Tikka')).toBeInTheDocument();
        expect(screen.getByText('[SAMPLE] Starters')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Availability of Paneer Tikka'), { target: { value: 'out_of_stock' } });
        await waitFor(async () => expect((await demo.getItems()).find((i) => i.name === 'Paneer Tikka')?.availability).toBe('out_of_stock'));
    });

    it('adds a category and an item, with validation', async () => {
        render(<WebsiteCms />);
        await screen.findByText('Paneer Tikka');
        fireEvent.change(screen.getByLabelText('New category name'), { target: { value: 'Drinks' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
        expect(await screen.findByText('Drinks')).toBeInTheDocument();

        const drinks = screen.getByText('Drinks').closest('div.space-y-3') as HTMLElement;
        fireEvent.click(within(drinks).getByRole('button', { name: /Add item/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Give the item a name.');

        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Masala Chai' } });
        fireEvent.change(screen.getByLabelText('Price (₹)'), { target: { value: '-1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Enter a price of 0 or more.');

        fireEvent.change(screen.getByLabelText('Price (₹)'), { target: { value: '30' } });
        fireEvent.change(screen.getByLabelText('Sizes ("Half: 260")'), { target: { value: 'Small 20' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(/Name: price/);

        fireEvent.change(screen.getByLabelText('Sizes ("Half: 260")'), { target: { value: 'Small: 20' } });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Vegetarian' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
        expect(await screen.findByText('Masala Chai')).toBeInTheDocument();
        const saved = (await demo.getItems()).find((i) => i.name === 'Masala Chai');
        expect(saved).toMatchObject({ price: 30, isVeg: true, variants: [expect.objectContaining({ name: 'Small', price: 20 })] });
    });

    it('edits, renames and deletes, and shows server errors', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        vi.spyOn(window, 'prompt').mockReturnValue('Small plates');
        render(<WebsiteCms />);
        await screen.findByText('Paneer Tikka');

        fireEvent.click(screen.getByLabelText('Edit Dal Makhani'));
        expect(screen.getByLabelText('Add-ons ("Extra cheese: 40")')).toHaveValue('Butter naan: 60');
        fireEvent.change(screen.getByLabelText('Price (₹)'), { target: { value: '275' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
        await waitFor(async () => expect((await demo.getItems()).find((i) => i.name === 'Dal Makhani')?.price).toBe(275));

        fireEvent.click(screen.getByLabelText('Rename [SAMPLE] Starters'));
        expect(await screen.findByText('Small plates')).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('Delete Small plates'));
        expect(await screen.findByRole('alert')).toHaveTextContent(/Move or delete the items/);

        fireEvent.click(screen.getByLabelText('Delete Chicken 65'));
        await waitFor(() => expect(screen.queryByText('Chicken 65')).not.toBeInTheDocument());
    });

    it('imports a CSV file and reports skipped rows', async () => {
        render(<WebsiteCms />);
        await screen.findByText('Paneer Tikka');
        const file = new File(['category,name,price\nDrinks,Lassi,90\nDrinks,,1'], 'menu.csv', { type: 'text/csv' });
        fireEvent.change(screen.getByLabelText('Import menu CSV'), { target: { files: [file] } });
        expect(await screen.findByRole('status')).toHaveTextContent('Imported 1 new and updated 0. 1 row(s) skipped: row 3');
        expect(await screen.findByText('Lassi')).toBeInTheDocument();
    });
});

describe('Offers tab', () => {
    it('lists offers and creates one', async () => {
        render(<WebsiteCms initialTab="offers" />);
        expect(await screen.findByText('[SAMPLE] Weekday lunch')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /New offer/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Save offer' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Give the offer a name.');

        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Diwali' } });
        fireEvent.change(screen.getByLabelText('What it gives'), { target: { value: 'flat_off' } });
        fireEvent.change(screen.getByLabelText('Amount off (₹)'), { target: { value: '100' } });
        fireEvent.change(screen.getByLabelText('Coupon code (optional)'), { target: { value: 'diwali' } });
        fireEvent.click(screen.getByRole('button', { name: 'Sat' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save offer' }));
        expect(await screen.findByText('Diwali')).toBeInTheDocument();
        const created = (await demo.getOffers()).find((o) => o.title === 'Diwali');
        expect(created).toMatchObject({ code: 'DIWALI', reward: { kind: 'flat_off', amount: 100 }, schedule: expect.objectContaining({ days: ['sat'] }) });
    });

    it('edits and deletes an offer', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        render(<WebsiteCms initialTab="offers" />);
        await screen.findByText('[SAMPLE] Weekday lunch');
        fireEvent.click(screen.getByLabelText('Edit [SAMPLE] Weekday lunch'));
        expect(screen.getByLabelText('Percent')).toHaveValue('15');
        fireEvent.click(screen.getByRole('button', { name: 'Mon' }));
        fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'paused' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save offer' }));
        expect(await screen.findByText('Paused')).toBeInTheDocument();
        expect((await demo.getOffers()).find((o) => o.id === 'demo-offer-1')?.status).toBe('paused');
        expect((await demo.getOffers()).find((o) => o.id === 'demo-offer-1')?.schedule.days).not.toContain('mon');

        fireEvent.click(await screen.findByLabelText('Delete [SAMPLE] Free delivery weekend'));
        await waitFor(() => expect(screen.queryByText('[SAMPLE] Free delivery weekend')).not.toBeInTheDocument());
    });
});

describe('Offers form details', () => {
    it('fills every field, cancels, and shows load and save errors', async () => {
        const api = await import('../../api');
        render(<WebsiteCms initialTab="offers" />);
        await screen.findByText('[SAMPLE] Weekday lunch');

        fireEvent.click(screen.getByRole('button', { name: /New offer/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('button', { name: 'Save offer' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /New offer/ }));
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Late night' } });
        fireEvent.change(screen.getByLabelText('Percent'), { target: { value: '20' } });
        fireEvent.change(screen.getByLabelText('Up to ₹ (optional)'), { target: { value: '100' } });
        fireEvent.change(screen.getByLabelText('Minimum order ₹ (optional)'), { target: { value: '300' } });
        fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-12-01' } });
        fireEvent.change(screen.getByLabelText('Ends (optional)'), { target: { value: '2026-12-31' } });
        fireEvent.change(screen.getByLabelText('Daily from (optional)'), { target: { value: '22:00' } });
        fireEvent.change(screen.getByLabelText('Daily until'), { target: { value: '02:00' } });
        fireEvent.change(screen.getByLabelText('Description (optional)'), { target: { value: 'After 10pm' } });
        fireEvent.click(screen.getByLabelText('Show on my website'));
        fireEvent.click(screen.getByLabelText('Promote in my posts'));

        vi.spyOn(api.cmsAPI, 'createOffer').mockRejectedValueOnce(new Error('Another offer already uses the code X'));
        fireEvent.click(screen.getByRole('button', { name: 'Save offer' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Another offer already uses the code X');

        fireEvent.click(screen.getByRole('button', { name: 'Save offer' }));
        expect(await screen.findByText('Late night')).toBeInTheDocument();
        const created = (await demo.getOffers()).find((o) => o.title === 'Late night')!;
        expect(created).toMatchObject({
            description: 'After 10pm', minOrderValue: 300, showOnSite: false, promoteInContent: false,
            reward: { kind: 'percent_off', percent: 20, maxDiscount: 100 },
            schedule: { startsAt: '2026-12-01', endsAt: '2026-12-31', from: '22:00', to: '02:00' },
        });
    });

    it('shows a load error and a delete error', async () => {
        const api = await import('../../api');
        vi.spyOn(api.cmsAPI, 'getOffers').mockRejectedValueOnce(new Error('Network down'));
        const { unmount } = render(<WebsiteCms initialTab="offers" />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
        unmount();

        vi.spyOn(window, 'confirm').mockReturnValue(true);
        vi.spyOn(api.cmsAPI, 'deleteOffer').mockRejectedValueOnce(new Error('Offer not found'));
        render(<WebsiteCms initialTab="offers" />);
        fireEvent.click(await screen.findByLabelText('Delete [SAMPLE] Weekday lunch'));
        expect(await screen.findByRole('alert')).toHaveTextContent('Offer not found');
    });

    it('shows an empty state', async () => {
        const api = await import('../../api');
        vi.spyOn(api.cmsAPI, 'getOffers').mockResolvedValueOnce([]);
        render(<WebsiteCms initialTab="offers" />);
        expect(await screen.findByText(/No offers yet/)).toBeInTheDocument();
    });
});

describe('feature flag', () => {
    it('reads VITE_WEBSITE_CMS', async () => {
        const { isWebsiteCmsEnabled } = await import('../../lib/website-cms');
        vi.stubEnv('VITE_WEBSITE_CMS', 'true');
        expect(isWebsiteCmsEnabled()).toBe(true);
        vi.stubEnv('VITE_WEBSITE_CMS', '');
        expect(isWebsiteCmsEnabled()).toBe(false);
        vi.unstubAllEnvs();
    });
});

describe('Site content tab', () => {
    it('saves a draft, publishes, and restores an earlier version', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        render(<WebsiteCms />);
        fireEvent.click(await screen.findByRole('tab', { name: 'Site content' }));
        const tagline = await screen.findByLabelText('Tagline');
        expect(screen.getByText(/Live: version 1/)).toBeInTheDocument();

        fireEvent.change(tagline, { target: { value: 'Biryani, slow-cooked' } });
        expect(screen.getByText('Unpublished changes')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Monday opens'), { target: { value: '10:00' } });
        fireEvent.click(screen.getAllByLabelText('Closed')[6]);
        fireEvent.change(screen.getByLabelText('Gallery ("link | caption" per line)'), { target: { value: 'https://g.jpg | Patio' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
        expect(await screen.findByRole('status')).toHaveTextContent('Draft saved.');
        const saved = (await demo.getContent()).draft;
        expect(saved.tagline).toBe('Biryani, slow-cooked');
        expect(saved.gallery).toEqual([{ url: 'https://g.jpg', caption: 'Patio' }]);
        expect(saved.hours?.find((h) => h.day === 'Monday')?.open).toBe('10:00');
        expect(saved.hours?.find((h) => h.day === 'Sunday')?.closed).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
        expect(await screen.findByText('Published version 2.')).toBeInTheDocument();
        expect(screen.queryByText('Unpublished changes')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Restore/ }));
        expect(await screen.findByText('Version 1 is live again as version 3.')).toBeInTheDocument();
        expect(screen.getByLabelText('Tagline')).toHaveValue('[SAMPLE] Slow-cooked biryani since 1998');
    });

    it('edits pages, contact and theme, and publishes unsaved changes in one go', async () => {
        render(<WebsiteCms initialTab="content" />);
        await screen.findByLabelText('Tagline');
        fireEvent.click(screen.getByRole('button', { name: /Add page/ }));
        const titles = screen.getAllByLabelText('Title');
        fireEvent.change(titles[1], { target: { value: 'Events' } });
        fireEvent.change(screen.getAllByLabelText('Web address (e.g. catering)')[1], { target: { value: 'Events' } });
        fireEvent.change(screen.getByLabelText('Text of page Events'), { target: { value: 'Book the terrace.' } });
        fireEvent.click(screen.getByLabelText('Remove page [SAMPLE] Catering'));
        fireEvent.change(screen.getByLabelText('email'), { target: { value: 'hi@example.com' } });
        fireEvent.change(screen.getByLabelText('instagram link'), { target: { value: 'https://instagram.com/demo' } });
        fireEvent.change(screen.getByLabelText('Brand colour (hex, e.g. #6B4EFF)'), { target: { value: '#6B4EFF' } });
        fireEvent.change(screen.getByLabelText('Search title'), { target: { value: 'Demo Kitchen' } });
        fireEvent.click(screen.getByLabelText('Show'));
        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
        expect(await screen.findByText('Published version 2.')).toBeInTheDocument();
        const live = (await demo.getContent()).published!;
        expect(live.pages).toEqual([{ slug: 'events', title: 'Events', body: 'Book the terrace.', visible: true }]);
        expect(live.contact?.email).toBe('hi@example.com');
        expect(live.theme?.primaryColor).toBe('#6B4EFF');
        expect(live.announcement?.enabled).toBe(false);
    });

    it('shows an error when saving fails', async () => {
        const api = await import('../../api');
        vi.spyOn(api.cmsAPI, 'saveDraft').mockRejectedValueOnce(new Error('Colours must be hex like #6B4EFF.'));
        render(<WebsiteCms initialTab="content" />);
        await screen.findByLabelText('Tagline');
        fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Colours must be hex');
    });
});
